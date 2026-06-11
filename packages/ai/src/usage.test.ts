import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { estimateCostUsd } from './pricing';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    aiUsageLog: { create: vi.fn(), aggregate: vi.fn() },
    notification: { findFirst: vi.fn(), createMany: vi.fn() },
    user: { findMany: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));

vi.mock('@hmp/db', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, prisma: prismaMock };
});

// Import after the mock is wired.
import { recordAiUsage } from './usage';

beforeEach(() => {
  prismaMock.aiUsageLog.create.mockReset().mockResolvedValue({ id: 'u-1' });
  // Default: well under budget so the budget-warning branch is a no-op.
  prismaMock.aiUsageLog.aggregate.mockReset().mockResolvedValue({ _sum: { costUsd: 1 } });
  prismaMock.notification.findFirst.mockReset().mockResolvedValue(null);
  prismaMock.notification.createMany.mockReset().mockResolvedValue({ count: 0 });
  prismaMock.user.findMany.mockReset().mockResolvedValue([]);
  prismaMock.auditLog.create.mockReset().mockResolvedValue({ id: 'a-1' });
  delete process.env.AI_MONTHLY_BUDGET_USD;
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.AI_MONTHLY_BUDGET_USD;
});

describe('estimateCostUsd', () => {
  it('computes Haiku 4.5 cost from per-1k rates', () => {
    // 1000 in * 0.001/1k + 1000 out * 0.005/1k = 0.006
    expect(estimateCostUsd('claude-haiku-4-5-20251001', { in: 1000, out: 1000 })).toBeCloseTo(
      0.006,
      9,
    );
  });

  it('computes gpt-4o-mini cost', () => {
    // 1000 in * 0.00015/1k + 1000 out * 0.0006/1k = 0.00075
    expect(estimateCostUsd('gpt-4o-mini', { in: 1000, out: 1000 })).toBeCloseTo(0.00075, 9);
  });

  it('returns 0 for an unknown model (cannot price)', () => {
    expect(estimateCostUsd('some-future-model', { in: 5000, out: 5000 })).toBe(0);
  });

  it('returns 0 for zero tokens', () => {
    expect(estimateCostUsd('claude-haiku-4-5-20251001', { in: 0, out: 0 })).toBe(0);
  });

  it('embeddings have output rate 0 — only input billed', () => {
    // text-embedding-3-small: 1000 in * 0.00002/1k = 0.00002, out rate 0
    expect(estimateCostUsd('text-embedding-3-small', { in: 1000, out: 0 })).toBeCloseTo(0.00002, 9);
  });
});

describe('recordAiUsage', () => {
  it('writes one row with computed cost + null FKs defaulted', async () => {
    await recordAiUsage({
      operation: 'DRAFT_GENERATION',
      provider: 'openai',
      model: 'gpt-4o-mini',
      tokens: { in: 1000, out: 1000 },
      durationMs: 42,
      succeeded: true,
    });
    expect(prismaMock.aiUsageLog.create).toHaveBeenCalledTimes(1);
    const data = prismaMock.aiUsageLog.create.mock.calls[0]![0].data;
    expect(data).toMatchObject({
      userId: null,
      handoutId: null,
      operation: 'DRAFT_GENERATION',
      provider: 'openai',
      model: 'gpt-4o-mini',
      tokensIn: 1000,
      tokensOut: 1000,
      durationMs: 42,
      succeeded: true,
      errorMessage: null,
    });
    expect(data.costUsd).toBeCloseTo(0.00075, 9);
  });

  it('passes through actorId + handoutId when provided', async () => {
    await recordAiUsage({
      actorId: 'user-1',
      handoutId: 'handout-1',
      operation: 'QUALITY_REPORT',
      provider: 'anthropic',
      model: 'claude-haiku-4-5-20251001',
      tokens: { in: 100, out: 50 },
      durationMs: 10,
      succeeded: true,
    });
    const data = prismaMock.aiUsageLog.create.mock.calls[0]![0].data;
    expect(data.userId).toBe('user-1');
    expect(data.handoutId).toBe('handout-1');
  });

  it('is best-effort — a write failure does not throw', async () => {
    prismaMock.aiUsageLog.create.mockRejectedValue(new Error('db down'));
    await expect(
      recordAiUsage({
        operation: 'DRAFT_GENERATION',
        provider: 'openai',
        model: 'gpt-4o-mini',
        tokens: { in: 1, out: 1 },
        durationMs: 1,
        succeeded: true,
      }),
    ).resolves.toBeUndefined();
  });

  it('records the failure row but does NOT run the budget check (succeeded=false)', async () => {
    await recordAiUsage({
      operation: 'DRAFT_GENERATION',
      provider: 'openai',
      model: 'gpt-4o-mini',
      tokens: { in: 0, out: 0 },
      durationMs: 5,
      succeeded: false,
      errorMessage: 'boom',
    });
    expect(prismaMock.aiUsageLog.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.aiUsageLog.create.mock.calls[0]![0].data.succeeded).toBe(false);
    expect(prismaMock.aiUsageLog.aggregate).not.toHaveBeenCalled();
  });
});

describe('recordAiUsage → budget warning', () => {
  it('fires a single in-portal warning to admins when month-to-date is over budget', async () => {
    prismaMock.aiUsageLog.aggregate.mockResolvedValue({ _sum: { costUsd: 250 } }); // > $200 default
    prismaMock.user.findMany.mockResolvedValue([{ id: 'admin-1' }, { id: 'admin-2' }]);

    await recordAiUsage({
      operation: 'DRAFT_GENERATION',
      provider: 'openai',
      model: 'gpt-4o-mini',
      tokens: { in: 1000, out: 1000 }, // cost > 0
      durationMs: 5,
      succeeded: true,
    });

    expect(prismaMock.notification.createMany).toHaveBeenCalledTimes(1);
    const rows = prismaMock.notification.createMany.mock.calls[0]![0].data;
    expect(rows).toHaveLength(2);
    expect(rows[0].meta.kind).toBe('ai.budget.exceeded');
    expect(prismaMock.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('does not re-fire when a warning already exists for the month (dedup)', async () => {
    prismaMock.aiUsageLog.aggregate.mockResolvedValue({ _sum: { costUsd: 250 } });
    prismaMock.notification.findFirst.mockResolvedValue({ id: 'existing' });

    await recordAiUsage({
      operation: 'DRAFT_GENERATION',
      provider: 'openai',
      model: 'gpt-4o-mini',
      tokens: { in: 1000, out: 1000 },
      durationMs: 5,
      succeeded: true,
    });

    expect(prismaMock.notification.createMany).not.toHaveBeenCalled();
  });

  it('does not warn when under budget', async () => {
    prismaMock.aiUsageLog.aggregate.mockResolvedValue({ _sum: { costUsd: 10 } });
    await recordAiUsage({
      operation: 'DRAFT_GENERATION',
      provider: 'openai',
      model: 'gpt-4o-mini',
      tokens: { in: 1000, out: 1000 },
      durationMs: 5,
      succeeded: true,
    });
    expect(prismaMock.notification.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.notification.createMany).not.toHaveBeenCalled();
  });

  it('honors AI_MONTHLY_BUDGET_USD override', async () => {
    process.env.AI_MONTHLY_BUDGET_USD = '5';
    prismaMock.aiUsageLog.aggregate.mockResolvedValue({ _sum: { costUsd: 6 } }); // > $5
    prismaMock.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);
    await recordAiUsage({
      operation: 'DRAFT_GENERATION',
      provider: 'openai',
      model: 'gpt-4o-mini',
      tokens: { in: 1000, out: 1000 },
      durationMs: 5,
      succeeded: true,
    });
    expect(prismaMock.notification.createMany).toHaveBeenCalledTimes(1);
  });
});

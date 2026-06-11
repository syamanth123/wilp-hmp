import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient, HandoutStatus, RoleName } from '@hmp/db';
import { recordAiUsage } from '@hmp/ai';

/**
 * Integration test for the Prompt 17 AI cost ledger. Writes real AiUsageLog rows
 * to Postgres, so it probe-skips unless a DB is reachable + seeded — same
 * convention as sme-review.test.ts. Its unique value over usage.test.ts (which
 * mocks prisma) is the DB-specific behavior: the Decimal(12,6) cost round-trips,
 * and onDelete: SetNull preserves the ledger row when the user/handout is
 * deleted. Budget-warning LOGIC is covered deterministically by the unit test;
 * here we exercise it once end-to-end against a real month-to-date aggregate.
 */

const prisma = new PrismaClient();
const PREFIX = `AIUSAGE-TEST-${process.pid}-${Date.now()}`;

let ready = false;
let offeringId: string | null = null;
let facultyUserId: string | null = null;
const createdUserIds: string[] = [];
const createdRequestIds: string[] = [];
const createdUsageIds: string[] = [];

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const offering = await prisma.courseOffering.findFirst({ select: { id: true } });
    const faculty = await prisma.user.findFirst({
      where: { roles: { some: { role: { name: RoleName.FACULTY } } } },
      select: { id: true },
    });
    offeringId = offering?.id ?? null;
    facultyUserId = faculty?.id ?? null;
    ready = Boolean(offeringId && facultyUserId);
  } catch {
    ready = false;
  }
  if (!ready) console.warn('[ai-usage.integration] Postgres unreachable/unseeded — skipping.');
});

beforeEach(() => {
  // Default: budget so high the warning branch never fires (the row/SetNull
  // tests don't want notification side-effects). The dedicated budget test
  // overrides this.
  process.env.AI_MONTHLY_BUDGET_USD = '100000000';
});

afterAll(async () => {
  if (ready) {
    if (createdUsageIds.length) {
      await prisma.aiUsageLog.deleteMany({ where: { id: { in: createdUsageIds } } });
    }
    if (createdRequestIds.length) {
      await prisma.handoutRequest.deleteMany({ where: { id: { in: createdRequestIds } } });
    }
    if (createdUserIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
  }
  delete process.env.AI_MONTHLY_BUDGET_USD;
  await prisma.$disconnect();
});

async function seedRequestWithHandout(): Promise<{ requestId: string; handoutId: string }> {
  const n = createdRequestIds.length + 1;
  const request = await prisma.handoutRequest.create({
    data: {
      refNo: `${PREFIX}-REQ-${n}`,
      courseOfferingId: offeringId!,
      initiatedById: facultyUserId!,
      status: HandoutStatus.IN_PROGRESS,
      handout: { create: { status: HandoutStatus.IN_PROGRESS } },
    },
    select: { id: true, handout: { select: { id: true } } },
  });
  createdRequestIds.push(request.id);
  return { requestId: request.id, handoutId: request.handout!.id };
}

describe('AI cost ledger integration (Postgres)', () => {
  it('persists a row with Decimal cost + resolved FKs', async () => {
    if (!ready) return;
    const { handoutId } = await seedRequestWithHandout();
    await recordAiUsage({
      actorId: facultyUserId,
      handoutId,
      operation: 'DRAFT_GENERATION',
      provider: 'anthropic',
      model: 'claude-haiku-4-5-20251001',
      tokens: { in: 1000, out: 1000 }, // cost 0.006
      durationMs: 123,
      succeeded: true,
    });
    const row = await prisma.aiUsageLog.findFirst({
      where: { handoutId },
      orderBy: { createdAt: 'desc' },
    });
    expect(row).not.toBeNull();
    createdUsageIds.push(row!.id);
    expect(row!.userId).toBe(facultyUserId);
    expect(row!.operation).toBe('DRAFT_GENERATION');
    expect(Number(row!.costUsd)).toBeCloseTo(0.006, 6); // Decimal round-trips
    expect(row!.tokensIn).toBe(1000);
    expect(row!.succeeded).toBe(true);
  });

  it('onDelete:SetNull — the ledger row survives deletion of its user', async () => {
    if (!ready) return;
    const throwaway = await prisma.user.create({
      data: { email: `${PREFIX}-u@test.local`, name: 'Throwaway', active: true },
      select: { id: true },
    });
    await recordAiUsage({
      actorId: throwaway.id,
      handoutId: null,
      operation: 'FACULTY_RECOMMENDATION',
      provider: 'openai',
      model: 'text-embedding-3-small',
      tokens: { in: 500, out: 0 },
      durationMs: 10,
      succeeded: true,
    });
    const row = await prisma.aiUsageLog.findFirst({
      where: { userId: throwaway.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(row).not.toBeNull();
    createdUsageIds.push(row!.id);

    // Delete the user — the cost row must survive with userId nulled.
    await prisma.user.delete({ where: { id: throwaway.id } });
    const after = await prisma.aiUsageLog.findUnique({ where: { id: row!.id } });
    expect(after).not.toBeNull();
    expect(after!.userId).toBeNull();
  });

  it('onDelete:SetNull — the ledger row survives deletion of its handout', async () => {
    if (!ready) return;
    const { requestId, handoutId } = await seedRequestWithHandout();
    await recordAiUsage({
      actorId: facultyUserId,
      handoutId,
      operation: 'QUALITY_REPORT',
      provider: 'anthropic',
      model: 'claude-haiku-4-5-20251001',
      tokens: { in: 200, out: 100 },
      durationMs: 20,
      succeeded: true,
    });
    const row = await prisma.aiUsageLog.findFirst({
      where: { handoutId },
      orderBy: { createdAt: 'desc' },
    });
    expect(row).not.toBeNull();
    createdUsageIds.push(row!.id);

    // Deleting the request cascades to the handout; the cost row must survive
    // with handoutId nulled.
    await prisma.handoutRequest.delete({ where: { id: requestId } });
    createdRequestIds.splice(createdRequestIds.indexOf(requestId), 1);
    const after = await prisma.aiUsageLog.findUnique({ where: { id: row!.id } });
    expect(after).not.toBeNull();
    expect(after!.handoutId).toBeNull();
  });

  it('budget warning fires once per month for admins (dedup), end-to-end', async () => {
    if (!ready) return;
    const month = new Date().toISOString().slice(0, 7);
    // Clean any prior warning for this month so the assertion is deterministic.
    await prisma.notification.deleteMany({
      where: {
        AND: [
          { meta: { path: ['kind'], equals: 'ai.budget.exceeded' } },
          { meta: { path: ['month'], equals: month } },
        ],
      },
    });
    const adminCount = await prisma.user.count({
      where: { active: true, roles: { some: { role: { name: RoleName.ADMIN } } } },
    });
    if (adminCount === 0) return; // no admins seeded → nothing to assert

    // Tiny positive budget — the two fires below cost ~$0.012, comfortably over.
    // (0 is treated as "unset" by monthlyBudgetUsd → falls back to the $200 default.)
    process.env.AI_MONTHLY_BUDGET_USD = '0.001';

    const { handoutId } = await seedRequestWithHandout();
    const fire = () =>
      recordAiUsage({
        actorId: facultyUserId,
        handoutId,
        operation: 'STRUCTURED_DRAFT',
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
        tokens: { in: 1000, out: 1000 },
        durationMs: 5,
        succeeded: true,
      });
    await fire();
    await fire(); // second call must NOT duplicate the warning

    const warnings = await prisma.notification.count({
      where: {
        AND: [
          { meta: { path: ['kind'], equals: 'ai.budget.exceeded' } },
          { meta: { path: ['month'], equals: month } },
        ],
      },
    });
    expect(warnings).toBe(adminCount); // exactly one batch, not two

    // Cleanup the rows the two fires created + the warning notifications.
    const rows = await prisma.aiUsageLog.findMany({
      where: { handoutId },
      select: { id: true },
    });
    createdUsageIds.push(...rows.map((r) => r.id));
    await prisma.notification.deleteMany({
      where: {
        AND: [
          { meta: { path: ['kind'], equals: 'ai.budget.exceeded' } },
          { meta: { path: ['month'], equals: month } },
        ],
      },
    });
    await prisma.auditLog.deleteMany({ where: { action: 'ai.budget.exceeded', entityId: month } });
  });
});

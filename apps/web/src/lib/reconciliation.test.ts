import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { prismaMock, tagObjectMock, auditMock } = vi.hoisted(() => ({
  prismaMock: { attachment: { findMany: vi.fn(), update: vi.fn() } },
  tagObjectMock: vi.fn(),
  auditMock: vi.fn(),
}));

vi.mock('@hmp/db', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, prisma: prismaMock };
});
vi.mock('@hmp/integrations', () => ({
  getS3Client: () => ({}),
  tagObject: tagObjectMock,
}));
vi.mock('@/lib/audit', () => ({ audit: auditMock }));
vi.mock('@/lib/attachments', () => ({ ATTACHMENTS_BUCKET: 'test-bucket' }));

import { runReconciliationSweep } from './reconciliation';

beforeEach(() => {
  prismaMock.attachment.findMany.mockReset();
  prismaMock.attachment.update.mockReset().mockResolvedValue({});
  tagObjectMock.mockReset().mockResolvedValue(undefined);
  auditMock.mockReset().mockResolvedValue(undefined);
});

afterEach(() => vi.restoreAllMocks());

describe('runReconciliationSweep — archive-tagging effect', () => {
  it('reconciles untagged attachments: tags + records archivedTaggedAt + audits success', async () => {
    prismaMock.attachment.findMany.mockResolvedValue([
      { id: 'a1', s3Key: 'attachments/r1/k1' },
      { id: 'a2', s3Key: 'attachments/r1/k2' },
    ]);

    const summary = await runReconciliationSweep();

    expect(summary['archive-tagging']).toEqual({ found: 2, reconciled: 2, failed: 0 });
    expect(tagObjectMock).toHaveBeenCalledTimes(2);
    expect(prismaMock.attachment.update).toHaveBeenCalledTimes(2);
    // archivedTaggedAt is set on each repaired row
    expect(prismaMock.attachment.update.mock.calls[0]![0].data).toHaveProperty('archivedTaggedAt');
    const successAudits = auditMock.mock.calls.filter(
      (c) => c[0].action === 'reconciliation.success',
    );
    expect(successAudits).toHaveLength(2);
  });

  it('records reconciliation.failed and CONTINUES when a reconcile throws', async () => {
    prismaMock.attachment.findMany.mockResolvedValue([
      { id: 'a1', s3Key: 'k1' },
      { id: 'a2', s3Key: 'k2' },
    ]);
    tagObjectMock.mockRejectedValueOnce(new Error('S3 unreachable')); // first fails, second ok

    const summary = await runReconciliationSweep();

    expect(summary['archive-tagging']).toEqual({ found: 2, reconciled: 1, failed: 1 });
    const failedAudits = auditMock.mock.calls.filter(
      (c) => c[0].action === 'reconciliation.failed',
    );
    expect(failedAudits).toHaveLength(1);
    expect(failedAudits[0]![0].after).toMatchObject({ effect: 'archive-tagging' });
  });

  it('does not cascade when detect() throws — logs, returns zeros, never throws', async () => {
    prismaMock.attachment.findMany.mockRejectedValue(new Error('DB down'));
    const summary = await runReconciliationSweep();
    expect(summary['archive-tagging']).toEqual({ found: 0, reconciled: 0, failed: 0 });
    expect(tagObjectMock).not.toHaveBeenCalled();
  });

  it('passes perEffectLimit through to detect', async () => {
    prismaMock.attachment.findMany.mockResolvedValue([]);
    await runReconciliationSweep({ perEffectLimit: 25 });
    expect(prismaMock.attachment.findMany.mock.calls[0]![0].take).toBe(25);
  });
});

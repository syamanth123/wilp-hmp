import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PermanentJobError, type Job, type AiJob } from '@hmp/queue';

// vi.hoisted: the mock factory is hoisted above imports, so the symbols it
// references must be hoisted too (can't reference ordinary top-level vars).
const { runQualityReport, AiUnconfiguredError } = vi.hoisted(() => {
  class AiUnconfiguredError extends Error {
    constructor(m = 'unconfigured') {
      super(m);
      this.name = 'AiUnconfiguredError';
    }
  }
  return { runQualityReport: vi.fn(), AiUnconfiguredError };
});

// Mock @hmp/ai so the AI processor runs without a real provider.
vi.mock('@hmp/ai', () => ({ runQualityReport, AiUnconfiguredError }));

// processors.ts also imports ../lib/notifications (for the notification
// processor). Stub it so this focused test doesn't pull in prisma/SMTP.
vi.mock('../../lib/notifications', () => ({}));

import { processAiJob } from '../processors';

const aiJob = (): Job<AiJob> =>
  ({ data: { kind: 'quality_report', handoutVersionId: 'v1', requestId: 'r1' } }) as Job<AiJob>;

beforeEach(() => {
  runQualityReport.mockReset();
});

describe('processAiJob — permanent vs transient classification', () => {
  it('maps AiUnconfiguredError → PermanentJobError (no retry — retrying without a key never succeeds)', async () => {
    runQualityReport.mockRejectedValueOnce(new AiUnconfiguredError());
    await expect(processAiJob(aiJob())).rejects.toBeInstanceOf(PermanentJobError);
  });

  it('re-throws a transient error unchanged (BullMQ retries it)', async () => {
    const transient = new Error('LLM 503');
    runQualityReport.mockRejectedValueOnce(transient);
    await expect(processAiJob(aiJob())).rejects.toBe(transient);
  });

  it('resolves on success', async () => {
    runQualityReport.mockResolvedValueOnce({ score: 0.9 });
    await expect(processAiJob(aiJob())).resolves.toBeUndefined();
    expect(runQualityReport).toHaveBeenCalledWith({
      handoutVersionId: 'v1',
      bypassRateLimit: true,
    });
  });
});

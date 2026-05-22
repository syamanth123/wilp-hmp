import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Redis } from 'ioredis';
import type { Worker, Job } from 'bullmq';
import { getNotificationsQueue, closeQueues } from '../src/queues';
import { enqueueNotification } from '../src/enqueue';
import { runNotificationsWorker, PermanentJobError } from '../src/worker-factory';
import { closeConnection } from '../src/connection';
import type { NotifyJob } from '../src/job-types';

// ─── REQUIRES REAL REDIS ─────────────────────────────────────────────────────
// BullMQ does NOT work against ioredis-mock (its Worker needs Redis Lua +
// blocking commands like bzpopmin the mock lacks). So the queue MECHANICS are
// proven against a real Redis: the `ci` job provides one as a service; locally
// this suite SKIPS when Redis isn't reachable (mirrors the MinIO/Mailhog
// probe-skip precedent). The pure-logic tests in job-id.test.ts always run.
// ─────────────────────────────────────────────────────────────────────────────

async function probeRedis(): Promise<boolean> {
  const url = process.env.REDIS_URL;
  if (!url) return false;
  const r = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
    connectTimeout: 1500,
  });
  try {
    await r.connect();
    await r.ping();
    await r.quit();
    return true;
  } catch {
    r.disconnect();
    return false;
  }
}

const redisUp = await probeRedis();

const actor = { id: 'u1', name: 'Dr. X' };
const commentJob = (commentId: string): NotifyJob => ({
  kind: 'comment',
  requestId: 'r1',
  commentId,
  actor,
});

function waitForTerminal(worker: Worker, jobId: string, timeoutMs = 10_000) {
  return new Promise<'completed' | 'failed'>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`job ${jobId} did not finish in ${timeoutMs}ms`)),
      timeoutMs,
    );
    worker.on('completed', (job: Job) => {
      if (job.id === jobId) {
        clearTimeout(timer);
        resolve('completed');
      }
    });
    // BullMQ emits 'failed' on EVERY attempt, not just the final one. A job
    // awaiting a retry is in 'delayed'/'waiting', not 'failed' — only resolve
    // when the job is terminally failed (exhausted attempts OR unrecoverable).
    worker.on('failed', async (job: Job | undefined) => {
      if (job?.id !== jobId) return;
      const state = await job.getState().catch(() => 'failed');
      if (state === 'failed') {
        clearTimeout(timer);
        resolve('failed');
      }
    });
  });
}

describe.skipIf(!redisUp)('queue mechanics (real Redis)', () => {
  let workerConn: Redis;

  beforeAll(() => {
    workerConn = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
  });

  afterAll(async () => {
    await workerConn.quit().catch(() => undefined);
    await closeQueues();
    await closeConnection();
  });

  beforeEach(async () => {
    await getNotificationsQueue().obliterate({ force: true });
  });

  it('enqueues a job and the worker processes it with the right payload', async () => {
    const seen: NotifyJob[] = [];
    const worker = runNotificationsWorker(async (job) => {
      seen.push(job.data);
    }, workerConn);
    try {
      await enqueueNotification(commentJob('c-happy'));
      await waitForTerminal(worker, 'notify:comment:c-happy');
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ kind: 'comment', commentId: 'c-happy' });
    } finally {
      await worker.close();
    }
  });

  it('dedups: enqueueing the same job id twice processes it once', async () => {
    let processed = 0;
    const worker = runNotificationsWorker(async () => {
      processed += 1;
    }, workerConn);
    try {
      // Both adds happen while the job is waiting → BullMQ rejects the dup id.
      await enqueueNotification(commentJob('c-dup'));
      await enqueueNotification(commentJob('c-dup'));
      await waitForTerminal(worker, 'notify:comment:c-dup');
      // Give any (erroneous) second job a moment to also run.
      await new Promise((r) => setTimeout(r, 300));
      expect(processed).toBe(1);
    } finally {
      await worker.close();
    }
  });

  it('retries a transient failure and ends completed', async () => {
    let attempts = 0;
    const worker = runNotificationsWorker(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('transient SMTP blip');
    }, workerConn);
    try {
      await getNotificationsQueue().add('comment', commentJob('c-retry'), {
        jobId: 'notify:comment:c-retry',
        attempts: 3,
        backoff: { type: 'fixed', delay: 50 },
      });
      const outcome = await waitForTerminal(worker, 'notify:comment:c-retry');
      expect(outcome).toBe('completed');
      expect(attempts).toBe(2);
    } finally {
      await worker.close();
    }
  });

  it('ends failed after exhausting attempts on a persistent transient error', async () => {
    let attempts = 0;
    const worker = runNotificationsWorker(async () => {
      attempts += 1;
      throw new Error('still down');
    }, workerConn);
    try {
      await getNotificationsQueue().add('comment', commentJob('c-fail'), {
        jobId: 'notify:comment:c-fail',
        attempts: 2,
        backoff: { type: 'fixed', delay: 50 },
      });
      const outcome = await waitForTerminal(worker, 'notify:comment:c-fail');
      expect(outcome).toBe('failed');
      expect(attempts).toBe(2);
    } finally {
      await worker.close();
    }
  });

  it('fails immediately (no retry) on a PermanentJobError', async () => {
    let attempts = 0;
    const worker = runNotificationsWorker(async () => {
      attempts += 1;
      throw new PermanentJobError('missing template');
    }, workerConn);
    try {
      await getNotificationsQueue().add('comment', commentJob('c-perm'), {
        jobId: 'notify:comment:c-perm',
        attempts: 3,
        backoff: { type: 'fixed', delay: 50 },
      });
      const outcome = await waitForTerminal(worker, 'notify:comment:c-perm');
      expect(outcome).toBe('failed');
      expect(attempts).toBe(1); // UnrecoverableError → no further attempts
    } finally {
      await worker.close();
    }
  });
});

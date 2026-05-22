import {
  Worker,
  UnrecoverableError,
  type Job,
  type Processor,
  type ConnectionOptions,
} from 'bullmq';
import { getRedisConnection } from './connection';
import { NOTIFICATIONS_QUEUE, AI_QUEUE, type NotifyJob, type AiJob } from './job-types';

/**
 * Thrown by a processor when the failure is PERMANENT — a malformed payload, a
 * missing template, a deleted entity. Re-mapped to BullMQ's UnrecoverableError
 * so the job fails immediately with no further retry attempts (retrying would
 * fail forever and waste worker capacity). Transient failures (SMTP blip,
 * network) should be thrown as ordinary errors so BullMQ retries with backoff.
 */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentJobError';
  }
}

/**
 * Wraps a processor so a thrown PermanentJobError becomes BullMQ's
 * UnrecoverableError (fail-now, no retry), while any other error propagates as
 * retryable. Exported for unit testing the classification without Redis.
 */
export function wrapProcessor<T>(processor: (job: Job<T>) => Promise<void>): Processor<T> {
  return async (job: Job<T>) => {
    try {
      await processor(job);
    } catch (err) {
      if (err instanceof PermanentJobError) {
        // Skip remaining attempts — this will never succeed.
        throw new UnrecoverableError(err.message);
      }
      throw err; // transient — let BullMQ retry per the queue's backoff policy
    }
  };
}

export function runNotificationsWorker(
  processor: (job: Job<NotifyJob>) => Promise<void>,
  connection: ConnectionOptions = getRedisConnection(),
): Worker<NotifyJob> {
  return new Worker<NotifyJob>(NOTIFICATIONS_QUEUE, wrapProcessor(processor), {
    connection,
    concurrency: 10,
  });
}

export function runAiWorker(
  processor: (job: Job<AiJob>) => Promise<void>,
  connection: ConnectionOptions = getRedisConnection(),
): Worker<AiJob> {
  return new Worker<AiJob>(AI_QUEUE, wrapProcessor(processor), {
    connection,
    concurrency: 2, // LLM-rate-limited
  });
}

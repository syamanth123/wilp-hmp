import { Queue } from 'bullmq';
import { getRedisConnection } from './connection';
import { NOTIFICATIONS_QUEUE, AI_QUEUE, type NotifyJob, type AiJob } from './job-types';

/**
 * Lazy queue singletons. Constructed on first access so merely importing this
 * module (for types) doesn't require Redis. Default job options live here so
 * both the enqueue helpers and any direct producers share the same retry/
 * cleanup policy.
 */
let notificationsQueue: Queue<NotifyJob> | null = null;
let aiQueue: Queue<AiJob> | null = null;

export function getNotificationsQueue(): Queue<NotifyJob> {
  if (!notificationsQueue) {
    notificationsQueue = new Queue<NotifyJob>(NOTIFICATIONS_QUEUE, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 }, // 1s, 2s, 4s (≈1/3/9 family)
        removeOnComplete: 200, // keep last 200 for the admin "completed" view
        removeOnFail: 500, // keep last 500 failures for investigation
      },
    });
  }
  return notificationsQueue;
}

export function getAiQueue(): Queue<AiJob> {
  if (!aiQueue) {
    aiQueue = new Queue<AiJob>(AI_QUEUE, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 }, // 5s, then ~longer
        removeOnComplete: 200,
        removeOnFail: 500,
      },
    });
  }
  return aiQueue;
}

/** Closes queue producers (tests / shutdown). */
export async function closeQueues(): Promise<void> {
  await Promise.all([notificationsQueue?.close(), aiQueue?.close()].filter(Boolean));
  notificationsQueue = null;
  aiQueue = null;
}

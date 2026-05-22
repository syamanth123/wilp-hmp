import { getNotificationsQueue, getAiQueue } from './queues';
import { notifyJobId, type NotifyJob, type AiJob } from './job-types';

/**
 * Enqueues a notification job. The job id is derived from the payload
 * (see notifyJobId) so BullMQ de-duplicates accidental double-fires while
 * letting genuinely-distinct events through.
 *
 * Throws if Redis is unavailable — the caller (the dispatchOrEnqueue boundary
 * in apps/web) catches that and falls back to synchronous delivery, so a queue
 * outage degrades to today's behaviour rather than dropping the notification.
 */
export async function enqueueNotification(job: NotifyJob): Promise<void> {
  await getNotificationsQueue().add(job.kind, job, { jobId: notifyJobId(job) });
}

export async function enqueueAiJob(job: AiJob): Promise<void> {
  await getAiQueue().add(job.kind, job, { jobId: `ai:${job.kind}:${job.handoutVersionId}` });
}

import { getNotificationsQueue, getAiQueue, getScheduleQueue } from './queues';
import { notifyJobId, type NotifyJob, type AiJob, type ScheduleJob } from './job-types';

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

/** v1.4.2: queue one auto-publish (deduplicated per request and approval time). */
export async function enqueueScheduleJob(job: ScheduleJob, jobId: string): Promise<void> {
  await getScheduleQueue().add(job.kind, job, { jobId });
}

/**
 * v1.4.2: the repeating runs — every day at 09:00 and Monday 09:00, India time. Upserting by a fixed id
 * means starting the worker again (every release) never adds a second schedule.
 */
export async function registerSchedules(): Promise<void> {
  const q = getScheduleQueue();
  await q.upsertJobScheduler(
    'daily-0900-ist',
    { pattern: '0 9 * * *', tz: 'Asia/Kolkata' },
    { name: 'daily', data: { kind: 'daily' } },
  );
  await q.upsertJobScheduler(
    'weekly-mon-0900-ist',
    { pattern: '0 9 * * 1', tz: 'Asia/Kolkata' },
    { name: 'weekly', data: { kind: 'weekly' } },
  );
}

/**
 * Typed job payloads for the queues. The notification payloads mirror the
 * inputs of the `notify*` functions in apps/web (the worker reconstructs the
 * call from these). Kept as plain serialisable data — no functions, no class
 * instances — because BullMQ stores them as JSON in Redis.
 */

export interface ActorRef {
  id: string;
  name: string;
}

export type NotifyJob =
  | { kind: 'transition'; requestId: string; event: string; actor: ActorRef; occurredAtMs: number }
  | { kind: 'comment'; requestId: string; commentId: string; actor: ActorRef }
  | { kind: 'publish_export_ready'; requestId: string; actor: ActorRef; occurredAtMs: number }
  | { kind: 'manually_published'; requestId: string; actor: ActorRef };
// NOTE: notifySlaReminder is intentionally NOT queued — it returns a count the
// callers consume (`notified += await notifySlaReminder(...)` in the cron route
// and the admin manual-sweep action). Queueing would break that report. Same
// category as regenerateRecommendation: the caller awaits a result. See
// docs/dev-handoff-audit.md §1 (async-queue principle).

export type NotifyKind = NotifyJob['kind'];

export interface AiJob {
  kind: 'quality_report';
  handoutVersionId: string;
  requestId: string;
}

export const NOTIFICATIONS_QUEUE = 'notifications';
export const AI_QUEUE = 'ai';

/**
 * v1.4.2 — scheduled and follow-up work (docs/plans/v1.4.2-workload.md §10, §11): the daily 09:00 run
 * (reminders, escalation, digests), the Monday summary, and auto-publish after a final approval. One
 * at a time (concurrency 1). Each daily / weekly run is also recorded in the database (ScheduledRun),
 * so a repeated or retried job never sends twice.
 */
export const SCHEDULE_QUEUE = 'schedule';

export type ScheduleJob =
  | { kind: 'daily' }
  | { kind: 'weekly' }
  | { kind: 'auto_publish'; requestId: string; actor: ActorRef };

/**
 * Deterministic BullMQ job id for de-duplication. BullMQ rejects a second add
 * with the same id, so this both prevents accidental double-fires AND lets
 * genuinely-distinct events through.
 *
 * The rule: use the most specific NATURAL unique id available (commentId).
 * For events that only carry a requestId, append a per-occurrence timestamp so
 * distinct events (e.g. two SUBMITTED transitions across a rework loop) are NOT
 * collapsed — the workflow status guard, not the job id, prevents a true
 * duplicate transition.
 */
export function notifyJobId(job: NotifyJob): string {
  switch (job.kind) {
    case 'transition':
      return `notify:transition:${job.requestId}:${job.event}:${job.occurredAtMs}`;
    case 'comment':
      return `notify:comment:${job.commentId}`;
    case 'publish_export_ready':
      return `notify:export_ready:${job.requestId}:${job.occurredAtMs}`;
    case 'manually_published':
      return `notify:manually_published:${job.requestId}`;
  }
}

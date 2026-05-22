// @hmp/queue — BullMQ infrastructure (pure). No app imports → no dependency
// cycle with apps/web. apps/web imports the enqueue helpers; the worker
// entrypoint (apps/web/src/workers) imports the worker factory + the local
// notify dispatch impls. See docs/dev-handoff-audit.md §1 (split pattern).

export { getRedisConnection, closeConnection, isRedisConfigured } from './connection';
export {
  NOTIFICATIONS_QUEUE,
  AI_QUEUE,
  notifyJobId,
  type NotifyJob,
  type NotifyKind,
  type AiJob,
  type ActorRef,
} from './job-types';
export { getNotificationsQueue, getAiQueue, closeQueues } from './queues';
export { startHeartbeat, readHeartbeat, heartbeatKey } from './heartbeat';
export { enqueueNotification, enqueueAiJob } from './enqueue';
export {
  runNotificationsWorker,
  runAiWorker,
  wrapProcessor,
  PermanentJobError,
} from './worker-factory';
// Re-export the BullMQ types apps/web needs so it doesn't depend on bullmq
// directly — apps/web → @hmp/queue is the only edge.
export type { Job, Queue } from 'bullmq';

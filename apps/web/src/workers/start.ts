/**
 * Worker process entrypoint. Run with `pnpm workers` (tsx). Lives in apps/web
 * (not packages/queue) so it can import the local notify dispatch impls without
 * a package→app dependency cycle — @hmp/queue stays pure infra. See
 * docs/dev-handoff-audit.md §1.
 *
 * Processes two queues:
 *   notifications — dispatches by kind to the matching notify.dispatch* impl
 *   ai            — runs the handout quality report
 *
 * Publishes a TTL'd heartbeat per queue so the admin /admin/queues page can
 * show whether workers are actually running. Shuts down gracefully on
 * SIGTERM/SIGINT: stop heartbeats, drain in-flight jobs (worker.close()), then
 * close the Redis connection so the process can exit.
 */
import {
  runNotificationsWorker,
  runAiWorker,
  runScheduleWorker,
  registerSchedules,
  startHeartbeat,
  closeConnection,
} from '@hmp/queue';
import { processNotification, processAiJob, processScheduleJob } from './processors';

const notificationsWorker = runNotificationsWorker(processNotification);
const aiWorker = runAiWorker(processAiJob);
// v1.4.2: daily 09:00 run, Monday summary, auto-publish (one at a time).
const scheduleWorker = runScheduleWorker(processScheduleJob);
registerSchedules()
  .then(() => console.log('[workers] schedules: daily 09:00 and Monday 09:00 (India time)'))
  .catch((err) => console.error('[workers] schedules not registered:', err?.message));

const heartbeats = [
  startHeartbeat('notifications'),
  startHeartbeat('ai'),
  startHeartbeat('schedule'),
];

// Log the job lifecycle so the worker log proves processing actually happened
// (received → completed/failed), not just that the worker booted.
notificationsWorker.on('active', (job) => console.log(`[worker:notifications] active ${job.id}`));
notificationsWorker.on('completed', (job) =>
  console.log(`[worker:notifications] completed ${job.id}`),
);
notificationsWorker.on('failed', (job, err) => {
  console.error(`[worker:notifications] failed ${job?.id}:`, err?.message);
});
aiWorker.on('active', (job) => console.log(`[worker:ai] active ${job.id}`));
aiWorker.on('completed', (job) => console.log(`[worker:ai] completed ${job.id}`));
aiWorker.on('failed', (job, err) => {
  console.error(`[worker:ai] failed ${job?.id}:`, err?.message);
});
scheduleWorker.on('failed', (job, err) => {
  console.error(`[worker:schedule] failed ${job?.id}:`, err?.message);
});

console.log('[workers] started: notifications (concurrency 10), ai (concurrency 2), schedule (1)');

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[workers] ${signal} received — draining in-flight jobs…`);
  // Stop heartbeats FIRST: a live interval keeps the event loop alive and
  // prevents the process from exiting after the workers close.
  for (const h of heartbeats) clearInterval(h);
  await Promise.all([notificationsWorker.close(), aiWorker.close(), scheduleWorker.close()]);
  await closeConnection();
  console.log('[workers] shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

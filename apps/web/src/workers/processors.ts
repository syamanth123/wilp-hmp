import { PermanentJobError, type Job, type NotifyJob, type AiJob } from '@hmp/queue';
import { runQualityReport, AiUnconfiguredError } from '@hmp/ai';
// Relative imports (not the `@/` alias) on purpose: this module is loaded by
// the worker entrypoint via `tsx`, which doesn't resolve Next's tsconfig path
// alias. notifications.ts is portable (no `@/`, no next/*), so this resolves
// cleanly under tsx. See docs/dev-handoff-audit.md §1 (worker architecture).
import * as notify from '../lib/notifications';
import type { WorkflowEventType } from '../lib/notifications';

/**
 * Notification job processor. Dispatches by kind to the matching dispatch*
 * impl (the bodies extracted in 10a). The dispatch impls are best-effort —
 * they swallow per-recipient delivery failures and record them on the
 * Notification row (status FAILED), so this processor rarely throws. A throw
 * here means an infrastructure failure (e.g. DB unreachable in loadRequest),
 * which BullMQ then retries. See docs/dev-handoff-audit.md §1.
 */
export async function processNotification(job: Job<NotifyJob>): Promise<void> {
  const d = job.data;
  switch (d.kind) {
    case 'transition':
      return notify.dispatchTransition({
        requestId: d.requestId,
        event: d.event as WorkflowEventType,
        actor: d.actor,
      });
    case 'comment':
      return notify.dispatchComment({
        requestId: d.requestId,
        commentId: d.commentId,
        actor: d.actor,
      });
    case 'publish_export_ready':
      return notify.dispatchPublishExportReady({ requestId: d.requestId, actor: d.actor });
    case 'manually_published':
      return notify.dispatchManuallyPublished({ requestId: d.requestId, actor: d.actor });
  }
}

/**
 * AI job processor. A missing/unconfigured AI provider is a PERMANENT failure
 * — retrying without an API key will never succeed, so it's mapped to a
 * PermanentJobError (→ BullMQ UnrecoverableError → no retry; the admin "Retry"
 * button on such a job fails again immediately with the same reason). Any
 * other error is transient and retried.
 */
export async function processAiJob(job: Job<AiJob>): Promise<void> {
  try {
    await runQualityReport({ handoutVersionId: job.data.handoutVersionId, bypassRateLimit: true });
  } catch (err) {
    if (err instanceof AiUnconfiguredError) {
      throw new PermanentJobError('AI provider not configured — quality report cannot run');
    }
    throw err;
  }
}

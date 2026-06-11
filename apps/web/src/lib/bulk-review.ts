import { prisma, type RoleName, type HandoutStatus, type Prisma } from '@hmp/db';
import { parseCsv, parseQueueActionsCsv } from '@hmp/integrations';
import { notifyTransition, type WorkflowEventType } from '@/lib/notifications';

/**
 * Shared engine for the Prompt 15 bulk review-action uploads (PC / SME / HOG).
 *
 * One CSV shape (`request_reference, action, comment`); each role supplies a
 * `BulkReviewRoleConfig` describing its queue status, allowed actions, which
 * actions require a comment, the action→event map, an optional per-row
 * authority check (SME only), and an `executeRow` that performs the actual
 * `transition()` (PC/HOG inline the Approval write; SME reuses the
 * smeApprove/smeRevert helpers).
 *
 * Two-phase, atomic reject-all on validation:
 *   Pass 1 (per row, no writes): resolve request, status gate (== queueStatus),
 *     allowed-action gate, comment-required gate, authority gate, in-file dedup.
 *   Execute (only if Pass 1 clean): per row `executeRow()` (each row atomic via
 *     its own `transition()`), then a `*.bulk` marker audit + notify. A row
 *     whose transition throws → `failed` (partial), since per-row transitions
 *     aren't one upload-wide transaction (audit §1).
 */

export type BulkReviewErrorCode =
  | 'invalid_csv_format'
  | 'request_not_found'
  | 'request_not_in_queue'
  | 'comment_required'
  | 'invalid_action'
  | 'not_your_sme_assignment'
  | 'duplicate_row_in_file';

export interface BulkReviewError {
  line: number;
  field?: string;
  code: BulkReviewErrorCode;
  message: string;
}

export type BulkReviewResult =
  | { status: 'success'; applied: number; refNos: string[] }
  | {
      status: 'partial';
      applied: number;
      refNos: string[];
      failed: { refNo: string; reason: string }[];
    }
  | { status: 'rejected'; errors: BulkReviewError[]; rejectedCsv: string };

export interface BulkActor {
  id: string;
  roles: RoleName[];
  name: string;
}

export interface BulkReviewRoleConfig {
  /** The single status every action for this role operates from. */
  queueStatus: HandoutStatus;
  allowedActions: readonly string[];
  commentRequiredFor: readonly string[];
  eventMap: Record<string, WorkflowEventType>;
  /** `*.bulk` marker audit action, e.g. 'pc_review.bulk'. */
  auditAction: string;
  /** Per-row authority gate beyond status (SME only). Returns an error code or null. */
  authorityCheck?: (requestId: string, actor: BulkActor) => Promise<BulkReviewErrorCode | null>;
  /** Performs the transition + role-specific effects for one row. No notify, no marker audit. */
  executeRow: (
    action: string,
    requestId: string,
    comment: string,
    actor: BulkActor,
  ) => Promise<void>;
}

interface ResolvedRow {
  line: number;
  requestId: string;
  refNo: string;
  action: string;
  comment: string;
}

export async function bulkReview(
  config: BulkReviewRoleConfig,
  csv: string,
  actor: BulkActor,
): Promise<BulkReviewResult> {
  const parsed = parseQueueActionsCsv(csv);
  if (!parsed.ok) {
    const errors: BulkReviewError[] = parsed.errors.map((e) => ({
      line: e.line,
      code: 'invalid_csv_format' as const,
      message: e.message,
    }));
    return { status: 'rejected', errors, rejectedCsv: buildRejectedCsv(csv, errors) };
  }

  // ── Pass 1: per-row validation (no writes) ──────────────────────────────────
  const errors: BulkReviewError[] = [];
  const resolved: ResolvedRow[] = [];
  const seenRef = new Map<string, number>();

  for (let i = 0; i < parsed.rows.length; i++) {
    const row = parsed.rows[i]!;
    const line = i + 2;
    const comment = row.comment.trim();

    const firstSeen = seenRef.get(row.request_reference);
    if (firstSeen !== undefined) {
      errors.push({
        line,
        code: 'duplicate_row_in_file',
        message: `Row ${line} duplicates row ${firstSeen}: same request ${row.request_reference}`,
      });
      continue;
    }
    seenRef.set(row.request_reference, line);

    if (!config.allowedActions.includes(row.action)) {
      errors.push({
        line,
        field: 'action',
        code: 'invalid_action',
        message: `Action "${row.action}" is not allowed here (expected one of: ${config.allowedActions.join(', ')})`,
      });
      continue;
    }

    const request = await prisma.handoutRequest.findUnique({
      where: { refNo: row.request_reference },
      select: { id: true, status: true },
    });
    if (!request) {
      errors.push({
        line,
        field: 'request_reference',
        code: 'request_not_found',
        message: `No request with reference "${row.request_reference}"`,
      });
      continue;
    }
    if (request.status !== config.queueStatus) {
      errors.push({
        line,
        field: 'request_reference',
        code: 'request_not_in_queue',
        message: `Request ${row.request_reference} is not in your queue — status is ${request.status}, expected ${config.queueStatus}`,
      });
      continue;
    }
    if (config.commentRequiredFor.includes(row.action) && comment.length === 0) {
      errors.push({
        line,
        field: 'comment',
        code: 'comment_required',
        message: `Action "${row.action}" requires a comment`,
      });
      continue;
    }
    if (config.authorityCheck) {
      const authErr = await config.authorityCheck(request.id, actor);
      if (authErr) {
        errors.push({
          line,
          code: authErr,
          message: `You are not authorized to act on ${row.request_reference}`,
        });
        continue;
      }
    }

    resolved.push({
      line,
      requestId: request.id,
      refNo: row.request_reference,
      action: row.action,
      comment,
    });
  }

  if (errors.length > 0) {
    return { status: 'rejected', errors, rejectedCsv: buildRejectedCsv(csv, errors) };
  }

  // ── Execute: per-row transition + marker audit + notify ─────────────────────
  const bulkSessionId = crypto.randomUUID();
  const applied: string[] = [];
  const failed: { refNo: string; reason: string }[] = [];

  for (const r of resolved) {
    try {
      await config.executeRow(r.action, r.requestId, r.comment, actor);
    } catch (err) {
      failed.push({
        refNo: r.refNo,
        reason: err instanceof Error ? err.message : 'transition failed',
      });
      continue;
    }
    applied.push(r.refNo);
    // Best-effort marker audit + notify — the engine's per-transition audit
    // (inside executeRow's transition) is the authoritative record; these are
    // the grouping breadcrumb + the recipient ping.
    try {
      await prisma.auditLog.create({
        data: {
          actorId: actor.id,
          action: config.auditAction,
          entity: 'HandoutRequest',
          entityId: r.requestId,
          after: { action: r.action, bulkSessionId } as Prisma.InputJsonValue,
          requestId: r.requestId,
        },
      });
    } catch {
      // marker is a breadcrumb; never fail an applied row on it
    }
    await notifyTransition({
      requestId: r.requestId,
      event: config.eventMap[r.action]!,
      actor: { id: actor.id, name: actor.name },
    });
  }

  return failed.length === 0
    ? { status: 'success', applied: applied.length, refNos: applied }
    : { status: 'partial', applied: applied.length, refNos: applied, failed };
}

// ── Rejected-CSV builder (same shape as Prompts 13/14) ─────────────────────────
function buildRejectedCsv(csv: string, errors: BulkReviewError[]): string {
  const { header, rows } = parseCsv(csv);
  const cols = header.length > 0 ? header : ['request_reference', 'action', 'comment'];
  const byLine = new Map<number, BulkReviewError>();
  for (const e of errors) if (!byLine.has(e.line)) byLine.set(e.line, e);

  const out: string[] = [
    [...cols, '_status', '_error_code', '_error_message'].map(csvCell).join(','),
  ];
  rows.forEach((row, i) => {
    const err = byLine.get(i + 2);
    const cells = cols.map((c) => csvCell(row[c] ?? ''));
    cells.push('rejected', csvCell(err?.code ?? ''), csvCell(err?.message ?? ''));
    out.push(cells.join(','));
  });
  return out.join('\n') + '\n';
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

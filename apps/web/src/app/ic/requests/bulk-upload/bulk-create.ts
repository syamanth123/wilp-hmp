import {
  prisma,
  HandoutStatus,
  normalizeBitsCourseNumber,
  type Prisma,
  type RoleName,
} from '@hmp/db';
import { parseCsv, parseHandoutRequestsCsv } from '@hmp/integrations';
import { transition } from '@hmp/workflow';
import { notifyTransition } from '@/lib/notifications';
import { createRequestWithRefNo, RefNoRetryExhausted } from '../new/ref-no';

/**
 * IC bulk handout-request creation (Prompt 13).
 *
 * Split from the server-action layer (auth + revalidate live in actions.ts) so
 * the validate→create→transition pipeline is integration-testable with a real
 * actor object and no NextAuth context — same split as sme-review.ts.
 *
 * Pipeline (atomic reject-all):
 *   1. Parse CSV (structure) via @hmp/integrations parseHandoutRequestsCsv.
 *   2. Semantic-validate every row against the DB (programme-first resolution,
 *      in-file dedup, active-request dedup). LOOKUPS ONLY — no writes.
 *   3. If ANY row fails (parse or semantic): return { rejected } with per-row
 *      errors + a downloadable annotated CSV. Nothing is written.
 *   4. If ALL rows pass: ONE transaction creates N HandoutRequests at DRAFT
 *      (createRequestWithRefNo → sequential refNos) + one request.create.bulk
 *      AuditLog each (sharing a bulkSessionId for admin grouping).
 *   5. Post-commit: per request, transition(REQUEST_INITIATED) + notify. A row
 *      whose transition throws is reported as strandedAtDraft (partial) rather
 *      than failing the whole upload — the insert already committed.
 */

export type BulkErrorCode =
  | 'invalid_csv_format'
  | 'programme_not_found'
  | 'course_not_found'
  | 'semester_not_found'
  | 'no_course_offering_for_programme_course_pair'
  | 'duplicate_active_request_exists'
  | 'duplicate_row_in_file';

export interface BulkError {
  line: number;
  field?: string;
  code: BulkErrorCode;
  message: string;
}

export type BulkUploadResult =
  | { status: 'success'; created: number; refNos: string[] }
  | {
      status: 'partial';
      created: number;
      refNos: string[];
      strandedAtDraft: { refNo: string; reason: string }[];
    }
  | { status: 'rejected'; errors: BulkError[]; rejectedCsv: string };

export interface BulkActor {
  id: string;
  roles: RoleName[];
  name: string;
}

// A row that passed structural parsing AND resolved to a real CourseOffering.
interface ResolvedRow {
  line: number;
  courseOfferingId: string;
}

const ACTIVE_DEDUP_EXCLUDES: HandoutStatus[] = [HandoutStatus.REJECTED, HandoutStatus.ARCHIVED];

export async function bulkCreateHandouts(csv: string, actor: BulkActor): Promise<BulkUploadResult> {
  // ── 1. Structural parse ────────────────────────────────────────────────────
  const parsed = parseHandoutRequestsCsv(csv);
  if (!parsed.ok) {
    const errors: BulkError[] = parsed.errors.map((e) => ({
      line: e.line,
      code: 'invalid_csv_format' as const,
      message: e.message,
    }));
    return { status: 'rejected', errors, rejectedCsv: buildRejectedCsv(csv, errors) };
  }

  // ── 2. Semantic validation (lookups only, no writes) ────────────────────────
  const errors: BulkError[] = [];
  const resolved: ResolvedRow[] = [];
  // In-file dedup: offering id → the first CSV line that resolved to it.
  const seenOffering = new Map<string, number>();

  for (let i = 0; i < parsed.rows.length; i++) {
    const row = parsed.rows[i]!;
    const line = i + 2; // +1 header, +1 zero-based → 1-based

    const programme = await prisma.programme.findUnique({
      where: { code: row.programme_code },
      select: { id: true },
    });
    if (!programme) {
      errors.push({
        line,
        field: 'programme_code',
        code: 'programme_not_found',
        message: `No programme with code "${row.programme_code}"`,
      });
      continue;
    }

    // Programme-FIRST: a Semester is unique only within a programme
    // (@@unique([programmeId, name])), so the same name can exist under another
    // programme — resolve it through this row's programme.
    const semester = await prisma.semester.findUnique({
      where: { programmeId_name: { programmeId: programme.id, name: row.semester } },
      select: { id: true },
    });
    if (!semester) {
      errors.push({
        line,
        field: 'semester',
        code: 'semester_not_found',
        message: `No semester "${row.semester}" in programme "${row.programme_code}"`,
      });
      continue;
    }

    const normalized = normalizeBitsCourseNumber(row.course_code);
    const course = await prisma.course.findFirst({
      where: {
        OR: [
          { bitsCourseNumber: normalized },
          { alternateCodes: { has: normalized } },
          { code: normalized },
        ],
      },
      select: { id: true },
    });
    if (!course) {
      errors.push({
        line,
        field: 'course_code',
        code: 'course_not_found',
        message: `No course matching "${row.course_code}" (normalized "${normalized}")`,
      });
      continue;
    }

    const offering = await prisma.courseOffering.findUnique({
      where: { courseId_semesterId: { courseId: course.id, semesterId: semester.id } },
      select: { id: true },
    });
    if (!offering) {
      errors.push({
        line,
        code: 'no_course_offering_for_programme_course_pair',
        message: `No course offering links "${row.course_code}" to "${row.semester}" in "${row.programme_code}"`,
      });
      continue;
    }

    // In-file dedup: two rows resolving to the same offering.
    const firstSeen = seenOffering.get(offering.id);
    if (firstSeen !== undefined) {
      errors.push({
        line,
        code: 'duplicate_row_in_file',
        message: `Row ${line} duplicates row ${firstSeen}: same course offering`,
      });
      continue;
    }
    seenOffering.set(offering.id, line);

    // DB dedup: an active (non-REJECTED, non-ARCHIVED) request already exists.
    const clash = await prisma.handoutRequest.findFirst({
      where: { courseOfferingId: offering.id, status: { notIn: ACTIVE_DEDUP_EXCLUDES } },
      select: { refNo: true },
    });
    if (clash) {
      errors.push({
        line,
        code: 'duplicate_active_request_exists',
        message: `An active request (${clash.refNo}) already exists for this offering`,
      });
      continue;
    }

    resolved.push({ line, courseOfferingId: offering.id });
  }

  if (errors.length > 0) {
    return { status: 'rejected', errors, rejectedCsv: buildRejectedCsv(csv, errors) };
  }

  // ── 3. Atomic create (all rows valid) ───────────────────────────────────────
  // crypto.randomUUID is a Node/Web global in the Next server runtime.
  const bulkSessionId = crypto.randomUUID();
  let created: { id: string; refNo: string }[];
  try {
    created = await prisma.$transaction(async (tx) => {
      const out: { id: string; refNo: string }[] = [];
      for (const r of resolved) {
        const req = await createRequestWithRefNo(
          {
            courseOfferingId: r.courseOfferingId,
            initiatedById: actor.id,
            notes: null,
            previousHandoutUrl: null,
          },
          tx,
        );
        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            action: 'request.create.bulk',
            entity: 'HandoutRequest',
            entityId: req.id,
            after: {
              refNo: req.refNo,
              courseOfferingId: r.courseOfferingId,
              bulkSessionId,
            } as Prisma.InputJsonValue,
            requestId: req.id,
          },
        });
        out.push(req);
      }
      return out;
    });
  } catch (err) {
    if (err instanceof RefNoRetryExhausted) {
      return {
        status: 'rejected',
        errors: [
          {
            line: 0,
            code: 'invalid_csv_format',
            message: 'Could not allocate reference numbers right now — please retry the upload.',
          },
        ],
        rejectedCsv: buildRejectedCsv(csv, []),
      };
    }
    throw err;
  }

  // ── 4. Post-commit: drive each DRAFT → REQUESTED via the workflow engine ─────
  const strandedAtDraft: { refNo: string; reason: string }[] = [];
  for (const req of created) {
    try {
      await transition({
        requestId: req.id,
        event: 'REQUEST_INITIATED',
        actor: { id: actor.id, roles: actor.roles },
      });
      await notifyTransition({
        requestId: req.id,
        event: 'REQUEST_INITIATED',
        actor: { id: actor.id, name: actor.name },
      });
    } catch (err) {
      strandedAtDraft.push({
        refNo: req.refNo,
        reason: err instanceof Error ? err.message : 'transition failed',
      });
    }
  }

  const refNos = created.map((r) => r.refNo);
  return strandedAtDraft.length === 0
    ? { status: 'success', created: created.length, refNos }
    : { status: 'partial', created: created.length, refNos, strandedAtDraft };
}

// ── Rejected-CSV builder ───────────────────────────────────────────────────────
// Original columns + appended _status / _error_code / _error_message. Per the
// approved spec, _status is uniformly "rejected" (atomic reject-all); the error
// columns are populated ONLY on failing rows, so IC filters for a non-empty
// _error_code to find exactly which rows to fix, then re-uploads the whole file
// (re-upload is safe — dedup skips anything already created).
function buildRejectedCsv(csv: string, errors: BulkError[]): string {
  const { header, rows } = parseCsv(csv);
  const cols = header.length > 0 ? header : ['programme_code', 'course_code', 'semester'];
  const byLine = new Map<number, BulkError>();
  for (const e of errors) if (!byLine.has(e.line)) byLine.set(e.line, e);

  const out: string[] = [
    [...cols, '_status', '_error_code', '_error_message'].map(csvCell).join(','),
  ];
  rows.forEach((row, i) => {
    const line = i + 2;
    const err = byLine.get(line);
    const cells = cols.map((c) => csvCell(row[c] ?? ''));
    cells.push('rejected', csvCell(err?.code ?? ''), csvCell(err?.message ?? ''));
    out.push(cells.join(','));
  });
  return out.join('\n') + '\n';
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

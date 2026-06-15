import {
  prisma,
  RoleName,
  HandoutStatus,
  ApprovalStage,
  ApprovalDecision,
  FacultyType,
  type Prisma,
} from '@hmp/db';
import { parseCsv, parseAllocationsCsv } from '@hmp/integrations';
import { transition, isCappedFacultyType, WorkflowError } from '@hmp/workflow';
import { notifyTransition } from '@/lib/notifications';

/**
 * HOG bulk faculty + SME allocation (Prompt 14).
 *
 * Addresses EXISTING requests by refNo (vs Prompt 13 which creates new ones).
 * Split from the action layer (auth + revalidate in actions.ts) so the
 * two-pass pipeline is integration-testable without NextAuth.
 *
 * Two-pass validation (atomic reject-all), then per-row execution:
 *   Pass 1 — per row, no writes: resolve request (refNo + status REQUESTED),
 *     faculty emails (split + FACULTY role), SME (SME role); in-file dedup on
 *     refNo. Collect every per-row error.
 *   Pass 2 — runs only if Pass 1 is clean: cumulative off-campus cap, keyed by
 *     (facultyId, semesterId) because the cap is per-semester. One batched
 *     query seeds existing counts; the CSV walk projects within-upload
 *     allocations.
 *   Execute — only if both passes are clean: per row, transition(FACULTY_
 *     ALLOCATED) reusing the single-allocate effects (FacultyAssignment +
 *     Approval + SmeAssignment + the in-tx cap re-check as a race guard) plus a
 *     request.allocate.bulk audit. transition() owns its own transaction, so
 *     each row is individually atomic; a later row throwing leaves earlier rows
 *     committed → `partial` (see audit §1).
 */

export type BulkAllocErrorCode =
  | 'invalid_csv_format'
  | 'request_not_found'
  | 'request_not_allocatable'
  | 'faculty_emails_empty'
  | 'faculty_not_found'
  | 'faculty_role_invalid'
  | 'faculty_inactive'
  | 'sme_not_found'
  | 'sme_role_invalid'
  | 'sme_inactive'
  | 'off_campus_cap_exceeded'
  | 'duplicate_row_in_file';

export interface BulkAllocError {
  line: number;
  field?: string;
  code: BulkAllocErrorCode;
  message: string;
}

export type BulkAllocateResult =
  | { status: 'success'; allocated: number; refNos: string[] }
  | {
      status: 'partial';
      allocated: number;
      refNos: string[];
      failed: { refNo: string; reason: string }[];
    }
  | { status: 'rejected'; errors: BulkAllocError[]; rejectedCsv: string };

export interface BulkActor {
  id: string;
  roles: RoleName[];
  name: string;
}

interface ResolvedFaculty {
  id: string;
  name: string;
  facultyType: FacultyType | null;
}
interface ResolvedRow {
  line: number;
  requestId: string;
  refNo: string;
  semesterId: string;
  semesterName: string;
  faculties: ResolvedFaculty[];
  smeUserId: string;
}

export async function bulkAllocate(csv: string, actor: BulkActor): Promise<BulkAllocateResult> {
  // ── 0. Structural parse ─────────────────────────────────────────────────────
  const parsed = parseAllocationsCsv(csv);
  if (!parsed.ok) {
    const errors: BulkAllocError[] = parsed.errors.map((e) => ({
      line: e.line,
      code: 'invalid_csv_format' as const,
      message: e.message,
    }));
    return { status: 'rejected', errors, rejectedCsv: buildRejectedCsv(csv, errors) };
  }

  const cap =
    (await prisma.workflowConfig.findUnique({ where: { key: 'default' } }))?.offCampusMaxCourses ??
    3;

  // ── 1. Per-row resolution (no writes) ───────────────────────────────────────
  const errors: BulkAllocError[] = [];
  const resolved: ResolvedRow[] = [];
  const seenRef = new Map<string, number>();

  for (let i = 0; i < parsed.rows.length; i++) {
    const row = parsed.rows[i]!;
    const line = i + 2;

    // In-file dedup on the raw refNo (before resolution, so dupes are caught
    // regardless of whether the request exists).
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

    const request = await prisma.handoutRequest.findUnique({
      where: { refNo: row.request_reference },
      select: {
        id: true,
        status: true,
        offering: { select: { semesterId: true, semester: { select: { name: true } } } },
      },
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
    if (request.status !== HandoutStatus.REQUESTED) {
      errors.push({
        line,
        field: 'request_reference',
        code: 'request_not_allocatable',
        message: `Request ${row.request_reference} is not allocatable — already at status ${request.status}`,
      });
      continue;
    }

    const emails = row.faculty_emails
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);
    if (emails.length === 0) {
      errors.push({
        line,
        field: 'faculty_emails',
        code: 'faculty_emails_empty',
        message: 'faculty_emails has no valid email after trimming',
      });
      continue;
    }
    const faculties: ResolvedFaculty[] = [];
    let facultyError: BulkAllocError | null = null;
    for (const email of emails) {
      const u = await prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          name: true,
          active: true,
          facultyType: true,
          roles: { select: { role: { select: { name: true } } } },
        },
      });
      if (!u) {
        facultyError = {
          line,
          field: 'faculty_emails',
          code: 'faculty_not_found',
          message: `No user with email "${email}"`,
        };
        break;
      }
      if (!u.roles.some((r) => r.role.name === RoleName.FACULTY)) {
        facultyError = {
          line,
          field: 'faculty_emails',
          code: 'faculty_role_invalid',
          message: `User "${email}" does not hold the FACULTY role`,
        };
        break;
      }
      // Match the single-action picker, which filters active=true: a deactivated
      // user must not be bulk-allocated (Prompt 18 — closes the Prompt 14 gap).
      if (!u.active) {
        facultyError = {
          line,
          field: 'faculty_emails',
          code: 'faculty_inactive',
          message: `User "${email}" is deactivated`,
        };
        break;
      }
      faculties.push({ id: u.id, name: u.name, facultyType: u.facultyType });
    }
    if (facultyError) {
      errors.push(facultyError);
      continue;
    }

    const sme = await prisma.user.findUnique({
      where: { email: row.sme_email },
      select: { id: true, active: true, roles: { select: { role: { select: { name: true } } } } },
    });
    if (!sme) {
      errors.push({
        line,
        field: 'sme_email',
        code: 'sme_not_found',
        message: `No user with email "${row.sme_email}"`,
      });
      continue;
    }
    if (!sme.roles.some((r) => r.role.name === RoleName.SME)) {
      errors.push({
        line,
        field: 'sme_email',
        code: 'sme_role_invalid',
        message: `User "${row.sme_email}" does not hold the SME role`,
      });
      continue;
    }
    // Match the single-action picker (active=true) — no bulk-allocating a
    // deactivated SME (Prompt 18 — closes the Prompt 14 gap).
    if (!sme.active) {
      errors.push({
        line,
        field: 'sme_email',
        code: 'sme_inactive',
        message: `User "${row.sme_email}" is deactivated`,
      });
      continue;
    }

    resolved.push({
      line,
      requestId: request.id,
      refNo: row.request_reference,
      semesterId: request.offering.semesterId,
      semesterName: request.offering.semester.name,
      faculties,
      smeUserId: sme.id,
    });
  }

  // ── 2. Cumulative off-campus cap (only if Pass 1 clean) ─────────────────────
  if (errors.length === 0) {
    await accumulateCapErrors(resolved, cap, errors);
  }

  if (errors.length > 0) {
    return { status: 'rejected', errors, rejectedCsv: buildRejectedCsv(csv, errors) };
  }

  // ── 3. Execute — per-row transition(FACULTY_ALLOCATED) ──────────────────────
  const bulkSessionId = crypto.randomUUID();
  const allocated: string[] = [];
  const failed: { refNo: string; reason: string }[] = [];

  for (const r of resolved) {
    try {
      await transition({
        requestId: r.requestId,
        event: 'FACULTY_ALLOCATED',
        actor: { id: actor.id, roles: actor.roles },
        meta: { facultyIds: r.faculties.map((f) => f.id), smeUserId: r.smeUserId, bulkSessionId },
        effects: async (tx) => {
          for (const f of r.faculties) {
            // Defense-in-depth: re-check the cap at execution time (catches a
            // race where a concurrent allocation filled the cap since Pass 2).
            // Prior rows in THIS upload are already committed, so this count
            // sees them too.
            const load = await tx.facultyAssignment.count({
              where: {
                facultyId: f.id,
                active: true,
                request: { offering: { semesterId: r.semesterId } },
              },
            });
            if (isCappedFacultyType(f.facultyType) && load >= cap) {
              throw new WorkflowError(
                'off_campus_cap_exceeded',
                `${f.name}: off-campus/adjunct faculty cannot exceed ${cap} courses per semester (current: ${load}).`,
              );
            }
            await tx.facultyAssignment.create({
              data: {
                requestId: r.requestId,
                facultyId: f.id,
                facultyType: f.facultyType ?? FacultyType.ON_CAMPUS,
              },
            });
          }
          await tx.approval.create({
            data: {
              requestId: r.requestId,
              stage: ApprovalStage.HOG_REVIEW,
              decision: ApprovalDecision.APPROVED,
              reviewerId: actor.id,
              decidedAt: new Date(),
            },
          });
          await tx.smeAssignment.create({
            data: { requestId: r.requestId, smeUserId: r.smeUserId, assignedById: actor.id },
          });
          await tx.auditLog.create({
            data: {
              actorId: actor.id,
              action: 'request.allocate.bulk',
              entity: 'HandoutRequest',
              entityId: r.requestId,
              after: {
                facultyIds: r.faculties.map((f) => f.id),
                smeUserId: r.smeUserId,
                bulkSessionId,
              } as Prisma.InputJsonValue,
              requestId: r.requestId,
            },
          });
        },
      });
      await notifyTransition({
        requestId: r.requestId,
        event: 'FACULTY_ALLOCATED',
        actor: { id: actor.id, name: actor.name },
      });
      allocated.push(r.refNo);
    } catch (err) {
      failed.push({
        refNo: r.refNo,
        reason: err instanceof Error ? err.message : 'transition failed',
      });
    }
  }

  return failed.length === 0
    ? { status: 'success', allocated: allocated.length, refNos: allocated }
    : { status: 'partial', allocated: allocated.length, refNos: allocated, failed };
}

// ── Cumulative cap accumulator ─────────────────────────────────────────────────
// Keyed by (facultyId, semesterId) because the cap is PER-SEMESTER — the same
// off-campus faculty across two semesters does not accumulate against itself.
async function accumulateCapErrors(
  resolved: ResolvedRow[],
  cap: number,
  errors: BulkAllocError[],
): Promise<void> {
  const capKey = (facultyId: string, semesterId: string) => `${facultyId}::${semesterId}`;
  const accum = new Map<string, number>();

  // ONE batched query (no N+1): all active assignments for every capped faculty
  // in the file; tally per (faculty, semester) in JS.
  const cappedIds = [
    ...new Set(
      resolved.flatMap((r) =>
        r.faculties.filter((f) => isCappedFacultyType(f.facultyType)).map((f) => f.id),
      ),
    ),
  ];
  if (cappedIds.length > 0) {
    const existing = await prisma.facultyAssignment.findMany({
      where: { facultyId: { in: cappedIds }, active: true },
      select: {
        facultyId: true,
        request: { select: { offering: { select: { semesterId: true } } } },
      },
    });
    for (const a of existing) {
      const k = capKey(a.facultyId, a.request.offering.semesterId);
      accum.set(k, (accum.get(k) ?? 0) + 1);
    }
  }

  for (const row of resolved) {
    for (const f of row.faculties) {
      if (!isCappedFacultyType(f.facultyType)) continue;
      const k = capKey(f.id, row.semesterId);
      const projected = (accum.get(k) ?? 0) + 1; // this allocation included
      accum.set(k, projected); // Always advance: subsequent rows for same (faculty, semester) get cumulative counts
      if (projected > cap) {
        errors.push({
          line: row.line,
          code: 'off_campus_cap_exceeded',
          message: `${f.name} would have ${projected} active assignments in ${row.semesterName} (cap: ${cap})`,
        });
      }
    }
  }
}

// ── Rejected-CSV builder (same shape as Prompt 13) ─────────────────────────────
function buildRejectedCsv(csv: string, errors: BulkAllocError[]): string {
  const { header, rows } = parseCsv(csv);
  const cols = header.length > 0 ? header : ['request_reference', 'faculty_emails', 'sme_email'];
  const byLine = new Map<number, BulkAllocError>();
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

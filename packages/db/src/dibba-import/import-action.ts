import { DibbaImportStatus, type Prisma, type PrismaClient } from '@prisma/client';
import { STANDARD_SLOTS } from '../dibba-slots';
import { capDibbaWarnings } from '../dibba-warnings';
import type { DibbaCourseType as ParsedCourseType, DibbaRow } from './types';

/**
 * Course Dibba persistence + lifecycle core (Phase 3). Takes `prisma` as a
 * parameter like corpus-import's import-action so it is testable against a
 * real Postgres without HTTP/session. The Route Handler and server actions in
 * apps/web are thin wrappers around these (auth, zod, revalidate).
 *
 * Invariants (docs/plans/phase-3-course-dibba.md D3/D9):
 *   - ONE PUBLISHED import per term: publish and discard run in ONE interactive
 *     transaction that first locks the term row (SELECT … FOR NO KEY UPDATE —
 *     self-conflicting, so two concurrent publishes or a publish racing a
 *     discard serialize, but compatible with the KEY SHARE lock the FK checker
 *     takes on the same row for every DibbaImport INSERT, so a 60 s upload does
 *     not stall a publish). There is no DB constraint for this (a partial
 *     unique index is not expressible in schema.prisma and would fail the
 *     migration-replay gate).
 *   - Status changes are conditional updates (`where: { status: DRAFT }`) whose
 *     count is checked; a mismatch throws and rolls everything back.
 *   - Audit rows are written through the SAME `tx` (apps/web's `audit()` uses
 *     the global client and would not be atomic).
 */

export type DibbaErrorCode = 'not_found' | 'not_draft' | 'term_exists';

export class DibbaError extends Error {
  constructor(
    public readonly code: DibbaErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'DibbaError';
  }
}

type Db = PrismaClient | Prisma.TransactionClient;

// ---------------------------------------------------------------------------
// Catalogue link (spec §5.7): bitsCourseNumber first, then alternateCodes
// ---------------------------------------------------------------------------

export interface CatalogueCourse {
  id: string;
  bitsCourseNumber: string;
  alternateCodes: string[];
}

/** Pure: Dibba code → Course id. Same rule at upload (stored courseId) and on the preview (live). */
export function matchCourseCodes(
  codes: Iterable<string>,
  courses: readonly CatalogueCourse[],
): Map<string, string> {
  const byNumber = new Map(courses.map((c) => [c.bitsCourseNumber, c.id]));
  const byAlternate = new Map<string, string>();
  for (const c of courses) {
    for (const alt of c.alternateCodes) if (!byAlternate.has(alt)) byAlternate.set(alt, c.id);
  }
  const out = new Map<string, string>();
  for (const code of codes) {
    const id = byNumber.get(code) ?? byAlternate.get(code);
    if (id !== undefined) out.set(code, id);
  }
  return out;
}

/** The one catalogue query both call sites use (no per-row lookups). `Course.active` is deliberately ignored. */
export async function findCatalogueCourses(
  db: Db,
  codes: readonly string[],
): Promise<CatalogueCourse[]> {
  if (codes.length === 0) return [];
  return db.course.findMany({
    where: {
      OR: [{ bitsCourseNumber: { in: [...codes] } }, { alternateCodes: { hasSome: [...codes] } }],
    },
    select: { id: true, bitsCourseNumber: true, alternateCodes: true },
  });
}

// ---------------------------------------------------------------------------
// Create (upload)
// ---------------------------------------------------------------------------

/** Parser string union → Prisma enum. Names are identical; this is the compile-time proof. */
const COURSE_TYPE: Record<ParsedCourseType, DibbaCourseTypeValue> = {
  CORE: 'CORE',
  ELECTIVE: 'ELECTIVE',
  PROJECT: 'PROJECT',
  BACKLOG: 'BACKLOG',
  NOT_OFFERED: 'NOT_OFFERED',
  UNSPECIFIED: 'UNSPECIFIED',
};
type DibbaCourseTypeValue = Prisma.DibbaEntryCreateManyInput['courseType'] & string;

export function toDibbaCourseType(t: ParsedCourseType): DibbaCourseTypeValue {
  return COURSE_TYPE[t];
}

/** Rows per `createMany` statement (1,077 rows × 17 columns is well inside Postgres' parameter limit; chunked for bigger files). */
export const DIBBA_ENTRY_CHUNK = 500;

export type DibbaSourceFormat = 'doc' | 'docx' | 'xlsx';

export interface CreateDibbaImportArgs {
  termId: string;
  label: string;
  sourceFilename: string;
  sourceFormat: DibbaSourceFormat;
  uploadedById: string;
  rows: readonly DibbaRow[];
  warnings: readonly string[];
}

export interface CreateDibbaImportResult {
  importId: string;
  rowCount: number;
  warningCount: number;
  /** Distinct course codes with no catalogue match (courseId null). */
  unknownCodeCount: number;
}

/**
 * Persist one parsed Dibba as a DRAFT import with all its entries, in one
 * transaction. Nothing is validated here beyond the FKs — the caller has
 * already parsed, capped and term-checked (apps/web Route Handler, §3 of the plan).
 */
export async function createDibbaImport(
  prisma: PrismaClient,
  args: CreateDibbaImportArgs,
): Promise<CreateDibbaImportResult> {
  const { rows } = args;
  // Bound what reaches DibbaImport.warnings — it is rendered in full on the
  // preview (D6), and the byte/row caps do not bound warnings.
  const warnings = capDibbaWarnings(args.warnings);
  const distinctCodes = [...new Set(rows.map((r) => r.courseCode))];
  const link = matchCourseCodes(distinctCodes, await findCatalogueCourses(prisma, distinctCodes));
  const importId = await prisma.$transaction(
    async (tx) => {
      const imp = await tx.dibbaImport.create({
        data: {
          termId: args.termId,
          label: args.label,
          sourceFilename: args.sourceFilename,
          sourceFormat: args.sourceFormat,
          rowCount: rows.length,
          warnings: [...warnings],
          uploadedById: args.uploadedById,
        },
        select: { id: true },
      });
      for (let i = 0; i < rows.length; i += DIBBA_ENTRY_CHUNK) {
        await tx.dibbaEntry.createMany({
          data: rows.slice(i, i + DIBBA_ENTRY_CHUNK).map((r) => ({
            importId: imp.id,
            programmeCode: r.programmeCode,
            programmeTitle: r.programmeTitle,
            admitBatch: r.admitBatch,
            isNewAdmission: r.isNewAdmission,
            isBacklogRow: r.isBacklogRow,
            studentCount: r.studentCount,
            slotNo: r.slotNo,
            slotDay: r.slotDay,
            slotSession: r.slotSession,
            courseCode: r.courseCode,
            courseTitle: r.courseTitle,
            courseType: toDibbaCourseType(r.courseType),
            erpCourseId: r.erpCourseId,
            classTimeHint: r.classTimeHint,
            remarks: r.remarks,
            rawCell: r.rawCell,
            courseId: link.get(r.courseCode) ?? null,
          })),
        });
      }
      return imp.id;
    },
    // First explicit transaction options in the repo: Prisma's 5 s default is
    // too tight for ~1,100 inserts on a loaded box.
    { timeout: 60_000, maxWait: 5_000 },
  );
  return {
    importId,
    rowCount: rows.length,
    warningCount: warnings.length,
    unknownCodeCount: distinctCodes.filter((c) => !link.has(c)).length,
  };
}

// ---------------------------------------------------------------------------
// Publish / discard
// ---------------------------------------------------------------------------

const LIFECYCLE_TX = { timeout: 15_000, maxWait: 5_000 } as const;

/**
 * Row lock on the term for the rest of the transaction (Postgres; table name is
 * the Prisma default — no @@map). NO KEY UPDATE rather than FOR UPDATE: it still
 * conflicts with itself (publish/publish, publish/discard serialize) but not
 * with the FOR KEY SHARE lock that the FK checker takes on this row for every
 * DibbaImport INSERT, so an in-flight upload transaction (up to 60 s) cannot
 * push a publish past its 15 s budget.
 */
async function lockTerm(tx: Prisma.TransactionClient, termId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "AcademicTerm" WHERE id = ${termId} FOR NO KEY UPDATE`;
}

export interface PublishDibbaImportResult {
  importId: string;
  termId: string;
  supersededIds: string[];
  publishedAt: Date;
}

/**
 * DRAFT → PUBLISHED, superseding the term's current PUBLISHED import(s), in one
 * transaction. `publishedAt` on a superseded import is kept (historical stamp).
 * Throws DibbaError('not_found' | 'not_draft'); nothing is changed on a throw.
 */
export async function publishDibbaImport(
  prisma: PrismaClient,
  args: { importId: string; actorId: string },
): Promise<PublishDibbaImportResult> {
  const { importId, actorId } = args;
  return prisma.$transaction(async (tx) => {
    const imp = await tx.dibbaImport.findUnique({
      where: { id: importId },
      select: { id: true, termId: true, status: true, label: true, rowCount: true },
    });
    if (!imp) throw new DibbaError('not_found');
    await lockTerm(tx, imp.termId);
    // Read the ids BEFORE flipping them (updateMany returns only a count).
    const superseded = await tx.dibbaImport.findMany({
      where: { termId: imp.termId, status: DibbaImportStatus.PUBLISHED, id: { not: importId } },
      select: { id: true, label: true },
    });
    const supersededIds = superseded.map((s) => s.id);
    if (supersededIds.length > 0) {
      await tx.dibbaImport.updateMany({
        where: { id: { in: supersededIds } },
        data: { status: DibbaImportStatus.SUPERSEDED },
      });
    }
    const publishedAt = new Date();
    const { count } = await tx.dibbaImport.updateMany({
      where: { id: importId, status: DibbaImportStatus.DRAFT },
      data: { status: DibbaImportStatus.PUBLISHED, publishedAt },
    });
    if (count !== 1) throw new DibbaError('not_draft');
    await tx.auditLog.create({
      data: {
        actorId,
        action: 'dibba.import.publish',
        entity: 'DibbaImport',
        entityId: importId,
        before: { status: imp.status, superseded },
        after: {
          status: DibbaImportStatus.PUBLISHED,
          termId: imp.termId,
          label: imp.label,
          rowCount: imp.rowCount,
          publishedAt: publishedAt.toISOString(),
        },
      },
    });
    return { importId, termId: imp.termId, supersededIds, publishedAt };
  }, LIFECYCLE_TX);
}

/**
 * Delete a DRAFT import (entries cascade) in one transaction under the term
 * lock, so a discard racing a publish can never remove the live schedule.
 * Throws DibbaError('not_found' | 'not_draft').
 */
export async function discardDibbaImport(
  prisma: PrismaClient,
  args: { importId: string; actorId: string },
): Promise<{ importId: string; termId: string }> {
  const { importId, actorId } = args;
  return prisma.$transaction(async (tx) => {
    const imp = await tx.dibbaImport.findUnique({
      where: { id: importId },
      select: { id: true, termId: true, status: true, label: true, rowCount: true },
    });
    if (!imp) throw new DibbaError('not_found');
    await lockTerm(tx, imp.termId);
    const { count } = await tx.dibbaImport.deleteMany({
      where: { id: importId, status: DibbaImportStatus.DRAFT },
    });
    if (count !== 1) throw new DibbaError('not_draft');
    await tx.auditLog.create({
      data: {
        actorId,
        action: 'dibba.import.discard',
        entity: 'DibbaImport',
        entityId: importId,
        before: {
          status: imp.status,
          termId: imp.termId,
          label: imp.label,
          rowCount: imp.rowCount,
        },
      },
    });
    return { importId, termId: imp.termId };
  }, LIFECYCLE_TX);
}

// ---------------------------------------------------------------------------
// Terms (IC create — Phase 3; edit is Phase 4)
// ---------------------------------------------------------------------------

export type AcademicTermKind = 'FIRST' | 'SECOND' | 'SUMMER';

export interface CreateAcademicTermArgs {
  name: string;
  year: number;
  term: AcademicTermKind;
  startDate: Date;
  endDate: Date;
  actorId: string;
}

/**
 * Create a term and seed its 8 SlotTiming rows from STANDARD_SLOTS (times
 * blank — Phase 4 edits them), with an audit row, in one transaction. A clash
 * on `name` or on (year, term) throws DibbaError('term_exists') naming the
 * existing term, so the IC form can say exactly what collided.
 */
export async function createAcademicTerm(
  prisma: PrismaClient,
  args: CreateAcademicTermArgs,
): Promise<{ termId: string }> {
  const { name, year, term, startDate, endDate, actorId } = args;
  return prisma.$transaction(async (tx) => {
    const clash = await tx.academicTerm.findFirst({
      where: { OR: [{ name }, { year, term }] },
      select: { name: true, year: true, term: true },
    });
    if (clash) {
      throw new DibbaError(
        'term_exists',
        clash.name === name
          ? `A term named '${name}' already exists.`
          : `A ${term} term for ${year} already exists: '${clash.name}'.`,
      );
    }
    const created = await tx.academicTerm.create({
      data: { name, year, term, startDate, endDate },
      select: { id: true },
    });
    await tx.slotTiming.createMany({
      data: STANDARD_SLOTS.map((s) => ({
        termId: created.id,
        slotNo: s.slotNo,
        day: s.day,
        session: s.session,
      })),
    });
    await tx.auditLog.create({
      data: {
        actorId,
        action: 'dibba.term.create',
        entity: 'AcademicTerm',
        entityId: created.id,
        after: {
          name,
          year,
          term,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        },
      },
    });
    return { termId: created.id };
  }, LIFECYCLE_TX);
}

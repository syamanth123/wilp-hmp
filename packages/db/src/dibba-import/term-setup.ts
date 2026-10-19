import { InstructorSource, Prisma, type ExamKind, type PrismaClient } from '@prisma/client';
import { STANDARD_SLOTS } from '../dibba-slots';
import { findDibbaCourseCodes } from '../course-code';
import { DibbaError, DIBBA_ENTRY_CHUNK, type AcademicTermKind } from './import-action';
import type { FacultyRow } from './types';

/**
 * Course Dibba term setup core (Phase 4, docs/plans/phase-4-course-dibba.md).
 * Everything "My Schedule" needs besides the published Dibba itself: the term's
 * dates, when each slot meets (class time), when each slot's exams are, and who
 * teaches what. Same shape as import-action.ts: `prisma` is a parameter, every
 * multi-row write is ONE transaction, audit rows go through the same `tx`,
 * failures throw DibbaError and change nothing.
 *
 * Wording: "slot", "class time", "exam date" — whether SL1–SL8 are class or exam
 * slots is unconfirmed (spec §10.1), so nothing here says either.
 */

type Db = PrismaClient | Prisma.TransactionClient;

const SETUP_TX = { timeout: 15_000, maxWait: 5_000 } as const;

/** The two exam kinds IC enters per slot; MAKEUP stays in the enum, unused by the UI. */
export const EXAM_KINDS_EDITABLE = [
  'MID_SEM',
  'COMPREHENSIVE',
] as const satisfies readonly ExamKind[];
export type EditableExamKind = (typeof EXAM_KINDS_EDITABLE)[number];

export const EXAM_KIND_LABEL: Record<EditableExamKind, string> = {
  MID_SEM: 'mid-semester exam',
  COMPREHENSIVE: 'comprehensive exam',
};

const SLOT_NUMBERS = new Set(STANDARD_SLOTS.map((s) => s.slotNo));

function requireSlotNo(slotNo: number): void {
  if (!Number.isInteger(slotNo) || !SLOT_NUMBERS.has(slotNo)) {
    throw new DibbaError('invalid_input', `Slot ${slotNo} is not one of the standard slots 1-8.`);
  }
}

async function requireTerm(db: Db, termId: string) {
  const term = await db.academicTerm.findUnique({
    where: { id: termId },
    select: { id: true, name: true, year: true, term: true, startDate: true, endDate: true },
  });
  if (!term) throw new DibbaError('not_found', 'That term no longer exists.');
  return term;
}

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Term edit (plan D3)
// ---------------------------------------------------------------------------

export interface UpdateAcademicTermArgs {
  termId: string;
  name: string;
  year: number;
  term: AcademicTermKind;
  startDate: Date;
  endDate: Date;
  actorId: string;
}

/**
 * Same uniqueness rule as createAcademicTerm (`name`; `(year, term)`), with the
 * term itself excluded. Throws DibbaError('not_found' | 'term_exists').
 */
export async function updateAcademicTerm(
  prisma: PrismaClient,
  args: UpdateAcademicTermArgs,
): Promise<void> {
  const { termId, name, year, term, startDate, endDate, actorId } = args;
  await prisma.$transaction(async (tx) => {
    const before = await requireTerm(tx, termId);
    const clash = await tx.academicTerm.findFirst({
      where: { id: { not: termId }, OR: [{ name }, { year, term }] },
      select: { name: true },
    });
    if (clash) {
      throw new DibbaError(
        'term_exists',
        clash.name === name
          ? `A term named '${name}' already exists.`
          : `A ${term} term for ${year} already exists: '${clash.name}'.`,
      );
    }
    await tx.academicTerm.update({
      where: { id: termId },
      data: { name, year, term, startDate, endDate },
    });
    await tx.auditLog.create({
      data: {
        actorId,
        action: 'dibba.term.update',
        entity: 'AcademicTerm',
        entityId: termId,
        before: {
          name: before.name,
          year: before.year,
          term: before.term,
          startDate: before.startDate.toISOString(),
          endDate: before.endDate.toISOString(),
        },
        after: {
          name,
          year,
          term,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        },
      },
    });
  }, SETUP_TX);
}

// ---------------------------------------------------------------------------
// Class times (plan D4)
// ---------------------------------------------------------------------------

export const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Pure: an error sentence, or null when the pair is acceptable. */
export function validateClassTime(startTime: string | null, endTime: string | null): string | null {
  if (!startTime && !endTime) return null;
  if (!startTime || !endTime) return 'Enter both a start and an end time, or neither.';
  if (!HHMM_RE.test(startTime) || !HHMM_RE.test(endTime)) {
    return 'Times must be HH:MM (24-hour), e.g. 09:00.';
  }
  if (endTime <= startTime) return 'The end time must be after the start time.';
  return null;
}

export interface ClassTimeInput {
  slotNo: number;
  startTime: string | null;
  endTime: string | null;
}

export interface UpdateSlotTimingsArgs {
  termId: string;
  timings: ClassTimeInput[];
  actorId: string;
}

/**
 * Writes only the slots whose times changed; a term that lacks its 8 rows gets
 * them created from STANDARD_SLOTS. Throws DibbaError('not_found' | 'invalid_input').
 */
export async function updateSlotTimings(
  prisma: PrismaClient,
  args: UpdateSlotTimingsArgs,
): Promise<{ changed: number[] }> {
  const { termId, timings, actorId } = args;
  const seen = new Set<number>();
  for (const t of timings) {
    requireSlotNo(t.slotNo);
    if (seen.has(t.slotNo))
      throw new DibbaError('invalid_input', `Slot ${t.slotNo} appears twice.`);
    seen.add(t.slotNo);
    const problem = validateClassTime(t.startTime || null, t.endTime || null);
    if (problem) throw new DibbaError('invalid_input', `Slot ${t.slotNo}: ${problem}`);
  }
  return prisma.$transaction(async (tx) => {
    await requireTerm(tx, termId);
    const existing = new Map(
      (await tx.slotTiming.findMany({ where: { termId } })).map((r) => [r.slotNo, r] as const),
    );
    const changed: Array<{
      slotNo: number;
      before: { startTime: string | null; endTime: string | null } | null;
      after: { startTime: string | null; endTime: string | null };
    }> = [];
    for (const t of timings) {
      const after = { startTime: t.startTime || null, endTime: t.endTime || null };
      const row = existing.get(t.slotNo);
      if (!row) {
        const std = STANDARD_SLOTS.find((s) => s.slotNo === t.slotNo)!;
        await tx.slotTiming.create({
          data: { termId, slotNo: t.slotNo, day: std.day, session: std.session, ...after },
        });
        changed.push({ slotNo: t.slotNo, before: null, after });
        continue;
      }
      if (row.startTime === after.startTime && row.endTime === after.endTime) continue;
      await tx.slotTiming.update({ where: { id: row.id }, data: after });
      changed.push({
        slotNo: t.slotNo,
        before: { startTime: row.startTime, endTime: row.endTime },
        after,
      });
    }
    if (changed.length > 0) {
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'dibba.term.slots.update',
          entity: 'AcademicTerm',
          entityId: termId,
          after: { changed },
        },
      });
    }
    return { changed: changed.map((c) => c.slotNo) };
  }, SETUP_TX);
}

// ---------------------------------------------------------------------------
// Exam dates (plan D5)
// ---------------------------------------------------------------------------

/** Dates IC may enter: the term's own span with a margin, so a typo'd year is caught. */
export function examDateWindow(term: { startDate: Date; endDate: Date }): { from: Date; to: Date } {
  const from = new Date(term.startDate);
  from.setDate(from.getDate() - 30);
  const to = new Date(term.endDate);
  to.setDate(to.getDate() + 60);
  return { from, to };
}

export interface ExamDateInput {
  slotNo: number;
  kind: EditableExamKind;
  /** null = remove the row. */
  date: Date | null;
  startTime: string | null;
  endTime: string | null;
}

export interface UpsertSlotExamDatesArgs {
  termId: string;
  dates: ExamDateInput[];
  actorId: string;
}

/**
 * Upsert on (termId, slotNo, kind); an empty date deletes the row. Throws
 * DibbaError('not_found' | 'invalid_input'); nothing is written on a throw.
 */
export async function upsertSlotExamDates(
  prisma: PrismaClient,
  args: UpsertSlotExamDatesArgs,
): Promise<{ upserted: number; deleted: number }> {
  const { termId, dates, actorId } = args;
  const seen = new Set<string>();
  for (const d of dates) {
    requireSlotNo(d.slotNo);
    if (!(EXAM_KINDS_EDITABLE as readonly string[]).includes(d.kind)) {
      throw new DibbaError('invalid_input', `Exam kind ${String(d.kind)} cannot be entered here.`);
    }
    const key = `${d.slotNo}|${d.kind}`;
    if (seen.has(key)) {
      throw new DibbaError(
        'invalid_input',
        `Slot ${d.slotNo} ${EXAM_KIND_LABEL[d.kind]} appears twice.`,
      );
    }
    seen.add(key);
    if (d.date) {
      if (Number.isNaN(d.date.getTime())) {
        throw new DibbaError(
          'invalid_input',
          `Slot ${d.slotNo} ${EXAM_KIND_LABEL[d.kind]}: enter a valid date.`,
        );
      }
      const problem = validateClassTime(d.startTime || null, d.endTime || null);
      if (problem) {
        throw new DibbaError(
          'invalid_input',
          `Slot ${d.slotNo} ${EXAM_KIND_LABEL[d.kind]}: ${problem}`,
        );
      }
    }
  }
  return prisma.$transaction(async (tx) => {
    const term = await requireTerm(tx, termId);
    const window = examDateWindow(term);
    let upserted = 0;
    let deleted = 0;
    const entries: Array<{ slotNo: number; kind: EditableExamKind; date: string | null }> = [];
    for (const d of dates) {
      if (!d.date) {
        const r = await tx.slotExamDate.deleteMany({
          where: { termId, slotNo: d.slotNo, kind: d.kind },
        });
        if (r.count > 0) {
          deleted += r.count;
          entries.push({ slotNo: d.slotNo, kind: d.kind, date: null });
        }
        continue;
      }
      if (d.date < window.from || d.date > window.to) {
        throw new DibbaError(
          'invalid_input',
          `Slot ${d.slotNo} ${EXAM_KIND_LABEL[d.kind]}: the date must fall between ${isoDay(window.from)} and ${isoDay(window.to)} (the term's dates with a margin).`,
        );
      }
      const data = {
        date: d.date,
        startTime: d.startTime || null,
        endTime: d.endTime || null,
      };
      await tx.slotExamDate.upsert({
        where: { termId_slotNo_kind: { termId, slotNo: d.slotNo, kind: d.kind } },
        create: { termId, slotNo: d.slotNo, kind: d.kind, ...data },
        update: data,
      });
      upserted += 1;
      entries.push({ slotNo: d.slotNo, kind: d.kind, date: isoDay(d.date) });
    }
    if (entries.length > 0) {
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'dibba.term.exams.update',
          entity: 'AcademicTerm',
          entityId: termId,
          after: { entries },
        },
      });
    }
    return { upserted, deleted };
  }, SETUP_TX);
}

// ---------------------------------------------------------------------------
// Faculty sheet import (plan D6)
// ---------------------------------------------------------------------------

export interface ImportFacultySheetArgs {
  termId: string;
  rows: FacultyRow[];
  /** Rows in the source before the parser dropped the ones without a course code. */
  sourceRowCount?: number;
  actorId: string;
}

export interface FacultySheetImportResult {
  totalRows: number;
  /** Distinct (course, user) pairs whose email matched an active user. */
  matched: number;
  /** Pairs written as DIBBA_SHEET rows (matched minus the ones already listed manually). */
  created: number;
  alreadyManual: number;
  noEmail: number;
  noCourseCode: number;
  unmatched: Array<{ email: string; name: string; courseCode: string }>;
}

/**
 * Replaces the term's DIBBA_SHEET instructor rows with the sheet's matched
 * rows in ONE transaction; MANUAL rows are left alone (and win on overlap).
 * Users are matched by case-insensitive email among ACTIVE users and are
 * NEVER created here — unmatched emails are returned (and audited) so IC can
 * ask an admin for the accounts. Throws DibbaError('not_found').
 */
export async function importFacultySheet(
  prisma: PrismaClient,
  args: ImportFacultySheetArgs,
): Promise<FacultySheetImportResult> {
  const { termId, rows, actorId } = args;
  const totalRows = args.sourceRowCount ?? rows.length;
  const noCourseCode = Math.max(0, totalRows - rows.length);

  const users = await prisma.user.findMany({
    where: { active: true },
    select: { id: true, email: true },
  });
  const byEmail = new Map(users.map((u) => [u.email.trim().toLowerCase(), u.id] as const));

  const pairs = new Map<string, { courseCode: string; userId: string; isLead: boolean }>();
  const unmatched = new Map<string, { email: string; name: string; courseCode: string }>();
  let noEmail = 0;
  for (const r of rows) {
    if (!r.email) {
      noEmail += 1;
      continue;
    }
    const email = r.email.trim().toLowerCase();
    const userId = byEmail.get(email);
    if (!userId) {
      const key = `${email}|${r.courseCode}`;
      if (!unmatched.has(key))
        unmatched.set(key, { email, name: r.facultyName, courseCode: r.courseCode });
      continue;
    }
    const key = `${r.courseCode}|${userId}`;
    const cur = pairs.get(key);
    if (cur) cur.isLead = cur.isLead || r.isLead;
    else pairs.set(key, { courseCode: r.courseCode, userId, isLead: r.isLead });
  }

  return prisma.$transaction(
    async (tx) => {
      await requireTerm(tx, termId);
      await tx.courseInstructor.deleteMany({
        where: { termId, source: InstructorSource.DIBBA_SHEET },
      });
      const manual = await tx.courseInstructor.findMany({
        where: { termId, source: InstructorSource.MANUAL },
        select: { courseCode: true, userId: true },
      });
      const manualKeys = new Set(manual.map((m) => `${m.courseCode}|${m.userId}`));
      const toCreate = [...pairs.values()].filter(
        (p) => !manualKeys.has(`${p.courseCode}|${p.userId}`),
      );
      for (let i = 0; i < toCreate.length; i += DIBBA_ENTRY_CHUNK) {
        await tx.courseInstructor.createMany({
          data: toCreate.slice(i, i + DIBBA_ENTRY_CHUNK).map((p) => ({
            termId,
            courseCode: p.courseCode,
            userId: p.userId,
            isLead: p.isLead,
            source: InstructorSource.DIBBA_SHEET,
          })),
        });
      }
      const result: FacultySheetImportResult = {
        totalRows,
        matched: pairs.size,
        created: toCreate.length,
        alreadyManual: pairs.size - toCreate.length,
        noEmail,
        noCourseCode,
        unmatched: [...unmatched.values()].sort((a, b) =>
          a.email === b.email
            ? a.courseCode.localeCompare(b.courseCode)
            : a.email.localeCompare(b.email),
        ),
      };
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'dibba.instructors.import',
          entity: 'AcademicTerm',
          entityId: termId,
          after: { ...result },
        },
      });
      return result;
    },
    { timeout: 60_000, maxWait: 5_000 },
  );
}

// ---------------------------------------------------------------------------
// Manual add / remove (plan D7)
// ---------------------------------------------------------------------------

export interface AddCourseInstructorArgs {
  termId: string;
  /** Free text; must contain exactly one Dibba course code. */
  courseCode: string;
  email: string;
  isLead: boolean;
  actorId: string;
}

/**
 * Throws DibbaError('invalid_input' | 'not_found' | 'user_not_found' | 'already_listed').
 */
export async function addCourseInstructor(
  prisma: PrismaClient,
  args: AddCourseInstructorArgs,
): Promise<{ id: string; courseCode: string; userId: string }> {
  const found = findDibbaCourseCodes(args.courseCode);
  if (found.length !== 1) {
    throw new DibbaError('invalid_input', 'Enter exactly one course code, e.g. "CS ZG501".');
  }
  const courseCode = found[0]!.code;
  const email = args.email.trim().toLowerCase();
  if (!email) throw new DibbaError('invalid_input', "Enter the instructor's email.");
  try {
    return await prisma.$transaction(async (tx) => {
      await requireTerm(tx, args.termId);
      const user = await tx.user.findFirst({
        where: { active: true, email: { equals: email, mode: 'insensitive' } },
        select: { id: true },
      });
      if (!user) {
        throw new DibbaError(
          'user_not_found',
          `No active HMP user has the email ${email} - an admin has to create the account first.`,
        );
      }
      const row = await tx.courseInstructor.create({
        data: {
          termId: args.termId,
          courseCode,
          userId: user.id,
          isLead: args.isLead,
          source: InstructorSource.MANUAL,
        },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          actorId: args.actorId,
          action: 'dibba.instructor.add',
          entity: 'CourseInstructor',
          entityId: row.id,
          after: {
            termId: args.termId,
            courseCode,
            userId: user.id,
            isLead: args.isLead,
            source: 'MANUAL',
          },
        },
      });
      return { id: row.id, courseCode, userId: user.id };
    }, SETUP_TX);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new DibbaError(
        'already_listed',
        `${email} is already listed for ${courseCode} in this term.`,
      );
    }
    throw err;
  }
}

export interface RemoveCourseInstructorArgs {
  id: string;
  actorId: string;
}

/** Removes a row of any source. Throws DibbaError('not_found'). */
export async function removeCourseInstructor(
  prisma: PrismaClient,
  args: RemoveCourseInstructorArgs,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const row = await tx.courseInstructor.findUnique({ where: { id: args.id } });
    if (!row) throw new DibbaError('not_found', 'That instructor row no longer exists.');
    await tx.courseInstructor.delete({ where: { id: row.id } });
    await tx.auditLog.create({
      data: {
        actorId: args.actorId,
        action: 'dibba.instructor.remove',
        entity: 'CourseInstructor',
        entityId: row.id,
        before: {
          termId: row.termId,
          courseCode: row.courseCode,
          userId: row.userId,
          isLead: row.isLead,
          source: row.source,
        },
      },
    });
  }, SETUP_TX);
}

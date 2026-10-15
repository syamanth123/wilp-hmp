import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DibbaImportStatus, InstructorSource, PrismaClient } from '@prisma/client';
import { createAcademicTerm } from '../dibba-import/import-action';
import { loadActiveTerm, loadFacultySchedule } from '../dibba-schedule/load';

/**
 * Integration test for the faculty-schedule loader (Phase 5, plan D1/D3): the
 * two course sources, equivalent-code merging, and — the security property —
 * that the result is keyed by the user id alone, so user B never sees A's
 * courses. Probe-skipped without Postgres; every row carries a per-run sentinel.
 */

const prisma = new PrismaClient();
const RUN = `${process.pid}-${Date.now()}`;
const SENTINEL = `DIBBA-SCHED-${RUN}`;
// A window no other test or seed uses, so pickActiveTerm can only choose ours.
const NOW = new Date(2041, 1, 15);
const YEAR = 9100 + (Date.now() % 700);

let dbReachable = false;
let userA = '';
let userB = '';
let termId = '';
const cleanup: Array<() => Promise<unknown>> = [];

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    console.warn('[dibba-schedule-load.test] Postgres unreachable - probe-skipping.');
    return;
  }
  const mkUser = async (tag: string) => {
    const u = await prisma.user.create({
      data: {
        email: `dibba.sched.${tag}.${RUN}@test.local`,
        name: `${SENTINEL} ${tag}`,
        active: true,
      },
      select: { id: true },
    });
    cleanup.push(() => prisma.auditLog.deleteMany({ where: { actorId: u.id } }));
    cleanup.push(() => prisma.user.delete({ where: { id: u.id } }));
    return u.id;
  };
  userA = await mkUser('a');
  userB = await mkUser('b');

  // Term with a PUBLISHED import containing three codes in two slots.
  ({ termId } = await createAcademicTerm(prisma, {
    name: SENTINEL,
    year: YEAR,
    term: 'FIRST',
    startDate: new Date(2041, 0, 1),
    endDate: new Date(2041, 4, 30),
    actorId: userA,
  }));
  cleanup.unshift(() => prisma.academicTerm.delete({ where: { id: termId } })); // slots/exams/instructors cascade
  const imp = await prisma.dibbaImport.create({
    data: {
      termId,
      label: `${SENTINEL} published`,
      sourceFilename: 'x.docx',
      sourceFormat: 'docx',
      status: DibbaImportStatus.PUBLISHED,
      publishedAt: NOW,
      rowCount: 4,
      uploadedById: userA,
      entries: {
        create: [
          // Assignment-sourced course for A, slot 1.
          row('ZZT ZG901', 'Sentinel Architecture', 1, 'HT01', 30),
          // Cross-listed pair: A is an instructor on ZZW only; both rows must appear as ONE course.
          row('ZZV ZC111', 'Sentinel Probability', 1, 'HT01', 40),
          row('ZZW ZC111', 'Sentinel Probability', 1, 'HB28', 25),
          // Nobody teaches this one.
          row('ZZX ZG903', 'Sentinel Orphan', 2, 'HT01', 12),
        ],
      },
    },
    select: { id: true },
  });
  cleanup.unshift(() => prisma.dibbaImport.delete({ where: { id: imp.id } }));
  await prisma.slotTiming.update({
    where: { termId_slotNo: { termId, slotNo: 1 } },
    data: { startTime: '09:00', endTime: '12:00' },
  });
  await prisma.slotExamDate.create({
    data: { termId, slotNo: 1, kind: 'MID_SEM', date: new Date(2041, 2, 10) },
  });

  // Catalogue: the pair is one course; the assignment course exists too.
  const pair = await prisma.course.create({
    data: {
      bitsCourseNumber: 'ZZV ZC111',
      code: 'ZZV ZC111',
      title: 'Sentinel Probability',
      alternateCodes: ['ZZW ZC111'],
    },
    select: { id: true },
  });
  cleanup.unshift(() => prisma.course.delete({ where: { id: pair.id } }));
  const arch = await prisma.course.create({
    data: { bitsCourseNumber: 'ZZT ZG901', code: 'ZZT ZG901', title: 'Sentinel Architecture' },
    select: { id: true },
  });
  cleanup.unshift(() => prisma.course.delete({ where: { id: arch.id } }));

  // Source 2: A teaches ZZW ZC111 by sheet; B is a co-instructor on it (so A sees B's name).
  await prisma.courseInstructor.createMany({
    data: [
      {
        termId,
        courseCode: 'ZZW ZC111',
        userId: userA,
        isLead: true,
        source: InstructorSource.DIBBA_SHEET,
      },
      {
        termId,
        courseCode: 'ZZV ZC111',
        userId: userB,
        isLead: false,
        source: InstructorSource.MANUAL,
      },
    ],
  });

  // Source 1: an HMP assignment for A in a semester with the term's (year, term).
  const prog = await prisma.programme.create({
    data: { code: `ZZP-${RUN}`, name: `${SENTINEL} programme` },
    select: { id: true },
  });
  cleanup.unshift(() => prisma.programme.delete({ where: { id: prog.id } })); // semesters cascade
  const sem = await prisma.semester.create({
    data: {
      programmeId: prog.id,
      name: `${SENTINEL} sem`,
      year: YEAR,
      term: 'FIRST',
      startDate: new Date(2041, 0, 1),
      endDate: new Date(2041, 4, 30),
    },
    select: { id: true },
  });
  const offering = await prisma.courseOffering.create({
    data: { courseId: arch.id, semesterId: sem.id },
    select: { id: true },
  });
  cleanup.unshift(() => prisma.courseOffering.delete({ where: { id: offering.id } }));
  const req = await prisma.handoutRequest.create({
    data: { refNo: `HMP-${SENTINEL}`, courseOfferingId: offering.id, initiatedById: userA },
    select: { id: true },
  });
  cleanup.unshift(() => prisma.handoutRequest.delete({ where: { id: req.id } })); // assignments cascade
  await prisma.facultyAssignment.create({
    data: { requestId: req.id, facultyId: userA, facultyType: 'ON_CAMPUS' },
  });
}, 60_000);

function row(
  courseCode: string,
  courseTitle: string,
  slotNo: number,
  programmeCode: string,
  studentCount: number,
) {
  return {
    programmeCode,
    programmeTitle: `${programmeCode} programme`,
    admitBatch: '2/2040',
    studentCount,
    slotNo,
    slotDay: slotNo === 1 ? 'SAT' : 'SAT',
    slotSession: slotNo === 1 ? 'FN' : 'AN',
    courseCode,
    courseTitle,
    rawCell: `${courseCode}|${courseTitle}`,
  };
}

afterAll(async () => {
  if (dbReachable) {
    for (const fn of cleanup) {
      try {
        await fn();
      } catch (err) {
        console.error('[dibba-schedule-load.test] cleanup step failed', err);
      }
    }
  }
  await prisma.$disconnect();
}, 60_000);

const integ = (name: string, fn: () => Promise<void>) =>
  it(
    name,
    async (ctx) => {
      if (!dbReachable) return ctx.skip();
      await fn();
    },
    30_000,
  );

describe('loadActiveTerm', () => {
  integ('picks the sentinel term for a date inside it', async () => {
    const t = await loadActiveTerm(prisma, NOW);
    expect(t?.id).toBe(termId);
    expect(t?.published?.label).toBe(`${SENTINEL} published`);
  });
});

describe('loadFacultySchedule', () => {
  integ(
    'user A: assignment course + sheet course (merged with its alternate), clash, co-instructor, exam',
    async () => {
      const s = await loadFacultySchedule(prisma, { userId: userA, now: NOW });
      expect(s.term?.id).toBe(termId);
      expect(s.courses.map((c) => c.codes)).toEqual([['ZZT ZG901'], ['ZZV ZC111', 'ZZW ZC111']]);
      const arch = s.courses[0]!;
      expect(arch.sources).toEqual(['assignment']);
      expect(arch.students).toBe(30);
      const pair = s.courses[1]!;
      expect(pair.sources).toEqual(['instructor']);
      expect(pair.students).toBe(65);
      expect(pair.coInstructors).toEqual([{ name: `${SENTINEL} b`, isLead: false }]);
      expect(pair.slots[0]).toMatchObject({ slotNo: 1, startTime: '09:00', endTime: '12:00' });
      expect(pair.slots[0]!.exams.map((e) => e.kind)).toEqual(['MID_SEM']);
      // Both of A's courses sit in slot 1 → one clash, the orphan course is not involved.
      expect(s.clashes).toHaveLength(1);
      expect(s.clashes[0]).toMatchObject({
        slotNo: 1,
        codes: ['ZZT ZG901', 'ZZV ZC111', 'ZZW ZC111'],
      });
      expect(s.grid.find((g) => g.slotNo === 1)?.clash).toBe(true);
      expect(s.courses.some((c) => c.codes.includes('ZZX ZG903'))).toBe(false);
    },
  );

  integ(
    "user B sees only their own manual course - never A's assignment or sheet rows",
    async () => {
      const s = await loadFacultySchedule(prisma, { userId: userB, now: NOW });
      expect(s.courses.map((c) => c.codes)).toEqual([['ZZV ZC111', 'ZZW ZC111']]);
      expect(s.courses[0]!.coInstructors).toEqual([{ name: `${SENTINEL} a`, isLead: true }]);
      expect(s.clashes).toEqual([]);
    },
  );

  integ('an unknown user gets the term but no courses', async () => {
    const s = await loadFacultySchedule(prisma, { userId: 'clzzzzzzzzzzzzzzzzzzzzzzz', now: NOW });
    expect(s.term?.id).toBe(termId);
    expect(s.courses).toEqual([]);
    expect(s.grid).toEqual([]);
  });
});

describe('only the PUBLISHED import counts', () => {
  integ('a DRAFT import for the same term never reaches the schedule', async () => {
    const draft = await prisma.dibbaImport.create({
      data: {
        termId,
        label: SENTINEL + ' draft',
        sourceFilename: 'd.docx',
        sourceFormat: 'docx',
        status: DibbaImportStatus.DRAFT,
        rowCount: 1,
        uploadedById: userA,
        entries: { create: [row('ZZY ZG904', 'Sentinel Draft Course', 2, 'HT01', 5)] },
      },
      select: { id: true },
    });
    const instr = await prisma.courseInstructor.create({
      data: { termId, courseCode: 'ZZY ZG904', userId: userA, source: InstructorSource.MANUAL },
      select: { id: true },
    });
    try {
      const s = await loadFacultySchedule(prisma, { userId: userA, now: NOW });
      expect(s.courses.some((c) => c.codes.includes('ZZY ZG904'))).toBe(false);
      expect(s.published?.label).toBe(SENTINEL + ' published');
    } finally {
      await prisma.courseInstructor.delete({ where: { id: instr.id } });
      await prisma.dibbaImport.delete({ where: { id: draft.id } });
    }
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { InstructorSource, PrismaClient } from '@prisma/client';
import { createAcademicTerm, DibbaError } from '../dibba-import/import-action';
import {
  addCourseInstructor,
  examDateWindow,
  importFacultySheet,
  removeCourseInstructor,
  updateAcademicTerm,
  updateSlotTimings,
  upsertSlotExamDates,
  validateClassTime,
} from '../dibba-import/term-setup';
import type { FacultyRow } from '../dibba-import/types';

/**
 * Integration tests for the Phase 4 term-setup core against the local Postgres
 * (probe-skipped when unreachable, same convention as the other suites).
 * Every row carries a per-run sentinel and is purged in afterAll.
 */

const prisma = new PrismaClient();
const RUN = `${process.pid}-${Date.now()}`;
const YEAR = 9000 + (Date.now() % 800); // far outside real years; (year, term) must be unique
const SENTINEL = `DIBBA-SETUP-${RUN}`;

let dbReachable = false;
let actorId = '';
let fac1Id = '';
let fac2Id = '';
const termIds: string[] = [];
const userIds: string[] = [];

const FAC1_EMAIL = `Dibba.Setup.One.${RUN}@Test.Local`; // mixed case on purpose
const FAC2_EMAIL = `dibba.setup.two.${RUN}@test.local`;
const INACTIVE_EMAIL = `dibba.setup.off.${RUN}@test.local`;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    console.warn('[dibba-term-setup.test] Postgres unreachable - probe-skipping.');
    return;
  }
  const mk = async (email: string, active: boolean) => {
    const u = await prisma.user.create({
      data: { email, name: `${SENTINEL} ${email.split('@')[0]}`, active },
      select: { id: true },
    });
    userIds.push(u.id);
    return u.id;
  };
  actorId = await mk(`dibba.setup.actor.${RUN}@test.local`, true);
  fac1Id = await mk(FAC1_EMAIL, true);
  fac2Id = await mk(FAC2_EMAIL, true);
  await mk(INACTIVE_EMAIL, false);
}, 60_000);

afterAll(async () => {
  if (dbReachable) {
    await prisma.courseInstructor.deleteMany({ where: { termId: { in: termIds } } });
    await prisma.slotExamDate.deleteMany({ where: { termId: { in: termIds } } });
    await prisma.slotTiming.deleteMany({ where: { termId: { in: termIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.academicTerm.deleteMany({ where: { id: { in: termIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  await prisma.$disconnect();
}, 60_000);

const integ = (name: string, fn: () => Promise<void>, timeout = 30_000) =>
  it(
    name,
    async (ctx) => {
      if (!dbReachable) return ctx.skip();
      await fn();
    },
    timeout,
  );

let termSeq = 0;
async function mkTerm(kind: 'FIRST' | 'SECOND' | 'SUMMER' = 'FIRST'): Promise<string> {
  termSeq += 1;
  const { termId } = await createAcademicTerm(prisma, {
    name: `${SENTINEL}-${termSeq}`,
    year: YEAR + termSeq,
    term: kind,
    startDate: new Date(2030, 7, 1),
    endDate: new Date(2030, 11, 15),
    actorId,
  });
  termIds.push(termId);
  return termId;
}

const expectDibbaError = async (p: Promise<unknown>, code: string) => {
  await expect(p).rejects.toMatchObject({ name: 'DibbaError', code });
};

describe('updateAcademicTerm', () => {
  integ('updates the five fields and writes an audit row with before/after', async () => {
    const termId = await mkTerm();
    await updateAcademicTerm(prisma, {
      termId,
      name: `${SENTINEL}-renamed`,
      year: YEAR + 500,
      term: 'SECOND',
      startDate: new Date(2031, 0, 10),
      endDate: new Date(2031, 4, 20),
      actorId,
    });
    const t = await prisma.academicTerm.findUniqueOrThrow({ where: { id: termId } });
    expect(t.name).toBe(`${SENTINEL}-renamed`);
    expect(t.year).toBe(YEAR + 500);
    expect(t.term).toBe('SECOND');
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'dibba.term.update', entityId: termId },
    });
    expect(audit?.before).toMatchObject({ term: 'FIRST' });
    expect(audit?.after).toMatchObject({ term: 'SECOND', year: YEAR + 500 });
  });

  integ(
    "rejects another term's name and another term's (year, term), but not its own",
    async () => {
      const a = await mkTerm();
      const b = await mkTerm();
      const bRow = await prisma.academicTerm.findUniqueOrThrow({ where: { id: b } });
      const base = { startDate: new Date(2030, 7, 1), endDate: new Date(2030, 11, 15), actorId };
      await expectDibbaError(
        updateAcademicTerm(prisma, { termId: a, name: bRow.name, year: 1, term: 'FIRST', ...base }),
        'term_exists',
      );
      await expectDibbaError(
        updateAcademicTerm(prisma, {
          termId: a,
          name: `${SENTINEL}-other`,
          year: bRow.year,
          term: 'FIRST',
          ...base,
        }),
        'term_exists',
      );
      const aRow = await prisma.academicTerm.findUniqueOrThrow({ where: { id: a } });
      await expect(
        updateAcademicTerm(prisma, {
          termId: a,
          name: aRow.name,
          year: aRow.year,
          term: 'FIRST',
          ...base,
        }),
      ).resolves.toBeUndefined();
    },
  );

  integ('unknown term → not_found', async () => {
    await expectDibbaError(
      updateAcademicTerm(prisma, {
        termId: 'clzzzzzzzzzzzzzzzzzzzzzzz',
        name: 'x',
        year: 1,
        term: 'FIRST',
        startDate: new Date(),
        endDate: new Date(),
        actorId,
      }),
      'not_found',
    );
  });
});

describe('validateClassTime (pure)', () => {
  it('accepts an empty pair and a well-formed ordered pair', () => {
    expect(validateClassTime(null, null)).toBeNull();
    expect(validateClassTime('09:00', '12:00')).toBeNull();
  });
  it('rejects half pairs, bad formats and reversed times', () => {
    expect(validateClassTime('09:00', null)).toMatch(/both/);
    expect(validateClassTime('9:00', '12:00')).toMatch(/HH:MM/);
    expect(validateClassTime('25:00', '26:00')).toMatch(/HH:MM/);
    expect(validateClassTime('12:00', '09:00')).toMatch(/after the start/);
    expect(validateClassTime('12:00', '12:00')).toMatch(/after the start/);
  });
});

describe('updateSlotTimings', () => {
  integ('writes only the slots that changed, idempotently, and audits them', async () => {
    const termId = await mkTerm();
    const r1 = await updateSlotTimings(prisma, {
      termId,
      timings: [
        { slotNo: 1, startTime: '09:00', endTime: '12:00' },
        { slotNo: 2, startTime: null, endTime: null },
      ],
      actorId,
    });
    expect(r1.changed).toEqual([1]);
    const r2 = await updateSlotTimings(prisma, {
      timings: [{ slotNo: 1, startTime: '09:00', endTime: '12:00' }],
      termId,
      actorId,
    });
    expect(r2.changed).toEqual([]);
    const rows = await prisma.slotTiming.findMany({
      where: { termId },
      orderBy: { slotNo: 'asc' },
    });
    expect(rows).toHaveLength(8);
    expect(rows[0]).toMatchObject({ slotNo: 1, startTime: '09:00', endTime: '12:00' });
    expect(rows[1]).toMatchObject({ slotNo: 2, startTime: null, endTime: null });
    expect(
      await prisma.auditLog.count({
        where: { action: 'dibba.term.slots.update', entityId: termId },
      }),
    ).toBe(1);
  });

  integ('rejects a bad pair before touching the database', async () => {
    const termId = await mkTerm();
    await expectDibbaError(
      updateSlotTimings(prisma, {
        termId,
        timings: [
          { slotNo: 1, startTime: '09:00', endTime: '12:00' },
          { slotNo: 3, startTime: '14:00', endTime: '13:00' },
        ],
        actorId,
      }),
      'invalid_input',
    );
    const slot1 = await prisma.slotTiming.findUniqueOrThrow({
      where: { termId_slotNo: { termId, slotNo: 1 } },
    });
    expect(slot1.startTime).toBeNull();
    await expectDibbaError(
      updateSlotTimings(prisma, {
        termId,
        timings: [{ slotNo: 9, startTime: null, endTime: null }],
        actorId,
      }),
      'invalid_input',
    );
  });

  integ('creates a missing slot row from the standard map', async () => {
    const termId = await mkTerm();
    await prisma.slotTiming.deleteMany({ where: { termId, slotNo: 7 } });
    const r = await updateSlotTimings(prisma, {
      termId,
      timings: [{ slotNo: 7, startTime: '18:00', endTime: '20:00' }],
      actorId,
    });
    expect(r.changed).toEqual([7]);
    const row = await prisma.slotTiming.findUniqueOrThrow({
      where: { termId_slotNo: { termId, slotNo: 7 } },
    });
    expect(row).toMatchObject({ day: 'SAT', session: 'EV', startTime: '18:00' });
  });
});

describe('upsertSlotExamDates', () => {
  it('examDateWindow is the term span with a 30/60-day margin (pure)', () => {
    const w = examDateWindow({ startDate: new Date(2030, 7, 1), endDate: new Date(2030, 11, 15) });
    expect(w.from).toEqual(new Date(2030, 6, 2));
    expect(w.to).toEqual(new Date(2031, 1, 13));
  });

  integ('upserts, updates, deletes on empty date, and refuses out-of-window dates', async () => {
    const termId = await mkTerm();
    const r1 = await upsertSlotExamDates(prisma, {
      termId,
      dates: [
        {
          slotNo: 1,
          kind: 'MID_SEM',
          date: new Date(2030, 9, 5),
          startTime: '10:00',
          endTime: '12:00',
        },
        {
          slotNo: 1,
          kind: 'COMPREHENSIVE',
          date: new Date(2030, 11, 20),
          startTime: null,
          endTime: null,
        },
        { slotNo: 2, kind: 'MID_SEM', date: null, startTime: null, endTime: null },
      ],
      actorId,
    });
    expect(r1).toEqual({ upserted: 2, deleted: 0 });
    const r2 = await upsertSlotExamDates(prisma, {
      termId,
      dates: [
        { slotNo: 1, kind: 'MID_SEM', date: new Date(2030, 9, 6), startTime: null, endTime: null },
        { slotNo: 1, kind: 'COMPREHENSIVE', date: null, startTime: null, endTime: null },
      ],
      actorId,
    });
    expect(r2).toEqual({ upserted: 1, deleted: 1 });
    const rows = await prisma.slotExamDate.findMany({ where: { termId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ slotNo: 1, kind: 'MID_SEM', startTime: null });
    expect(rows[0]!.date.getDate()).toBe(6);
    await expectDibbaError(
      upsertSlotExamDates(prisma, {
        termId,
        dates: [
          {
            slotNo: 3,
            kind: 'MID_SEM',
            date: new Date(2035, 0, 1),
            startTime: null,
            endTime: null,
          },
        ],
        actorId,
      }),
      'invalid_input',
    );
    await expectDibbaError(
      upsertSlotExamDates(prisma, {
        termId,
        dates: [
          {
            slotNo: 3,
            kind: 'MAKEUP' as 'MID_SEM',
            date: new Date(2030, 9, 1),
            startTime: null,
            endTime: null,
          },
        ],
        actorId,
      }),
      'invalid_input',
    );
    expect(await prisma.slotExamDate.count({ where: { termId } })).toBe(1);
  });
});

const sheetRow = (over: Partial<FacultyRow>): FacultyRow => ({
  courseCode: 'CS ZG501',
  slotNo: 1,
  facultyName: 'Someone',
  isLead: false,
  email: null,
  psrnOrGfid: null,
  department: null,
  campus: null,
  ...over,
});

describe('importFacultySheet', () => {
  integ(
    'matches active users by case-insensitive email, never creates users, replaces sheet rows, keeps manual rows',
    async () => {
      const termId = await mkTerm();
      const usersBefore = await prisma.user.count();
      // A manual row that the sheet also lists: must survive as MANUAL.
      await addCourseInstructor(prisma, {
        termId,
        courseCode: 'CS ZG501',
        email: FAC2_EMAIL,
        isLead: false,
        actorId,
      });
      const rows: FacultyRow[] = [
        sheetRow({ email: FAC1_EMAIL.toUpperCase(), isLead: true }),
        sheetRow({ email: FAC1_EMAIL.toLowerCase() }), // duplicate pair, lead wins
        sheetRow({ courseCode: 'SS ZG527', email: FAC1_EMAIL }),
        sheetRow({ courseCode: 'CS ZG501', email: FAC2_EMAIL }), // already listed manually
        sheetRow({ email: `nobody.${RUN}@test.local`, facultyName: 'No Account' }),
        sheetRow({ email: INACTIVE_EMAIL, facultyName: 'Left' }),
        sheetRow({ email: null, facultyName: 'Blank' }),
      ];
      const r = await importFacultySheet(prisma, {
        termId,
        rows,
        sourceRowCount: rows.length + 2,
        actorId,
      });
      expect(r).toMatchObject({
        totalRows: rows.length + 2,
        noCourseCode: 2,
        noEmail: 1,
        matched: 3,
        created: 2,
        alreadyManual: 1,
      });
      expect(r.unmatched.map((u) => u.email)).toEqual(
        [INACTIVE_EMAIL, `nobody.${RUN}@test.local`].sort(),
      );
      expect(await prisma.user.count()).toBe(usersBefore);
      const stored = await prisma.courseInstructor.findMany({
        where: { termId },
        orderBy: [{ courseCode: 'asc' }, { source: 'asc' }],
      });
      expect(
        stored.map((s) => [
          s.courseCode,
          s.userId === fac1Id ? 'fac1' : 'fac2',
          s.source,
          s.isLead,
        ]),
      ).toEqual([
        ['CS ZG501', 'fac1', InstructorSource.DIBBA_SHEET, true],
        ['CS ZG501', 'fac2', InstructorSource.MANUAL, false],
        ['SS ZG527', 'fac1', InstructorSource.DIBBA_SHEET, false],
      ]);
      // Re-import with a smaller sheet: old DIBBA_SHEET rows go, MANUAL stays.
      const r2 = await importFacultySheet(prisma, {
        termId,
        rows: [sheetRow({ courseCode: 'SS ZG527', email: FAC2_EMAIL })],
        actorId,
      });
      expect(r2).toMatchObject({ matched: 1, created: 1, alreadyManual: 0, unmatched: [] });
      const after = await prisma.courseInstructor.findMany({
        where: { termId },
        orderBy: { courseCode: 'asc' },
      });
      expect(after.map((s) => [s.courseCode, s.source])).toEqual([
        ['CS ZG501', InstructorSource.MANUAL],
        ['SS ZG527', InstructorSource.DIBBA_SHEET],
      ]);
      const audit = await prisma.auditLog.findFirst({
        where: { action: 'dibba.instructors.import', entityId: termId },
        orderBy: { createdAt: 'asc' },
      });
      expect(audit?.after).toMatchObject({ matched: 3, created: 2 });
    },
    60_000,
  );

  integ('unknown term → not_found, nothing written', async () => {
    await expectDibbaError(
      importFacultySheet(prisma, {
        termId: 'clzzzzzzzzzzzzzzzzzzzzzzz',
        rows: [sheetRow({ email: FAC1_EMAIL })],
        actorId,
      }),
      'not_found',
    );
  });
});

describe('addCourseInstructor / removeCourseInstructor', () => {
  integ(
    'adds a MANUAL row by email (any case), refuses duplicates, unknown and inactive users, bad codes',
    async () => {
      const termId = await mkTerm();
      const added = await addCourseInstructor(prisma, {
        termId,
        courseCode: '  cs zg501 ',
        email: FAC1_EMAIL.toUpperCase(),
        isLead: true,
        actorId,
      });
      expect(added.courseCode).toBe('CS ZG501');
      expect(added.userId).toBe(fac1Id);
      await expectDibbaError(
        addCourseInstructor(prisma, {
          termId,
          courseCode: 'CS ZG501',
          email: FAC1_EMAIL,
          isLead: false,
          actorId,
        }),
        'already_listed',
      );
      await expectDibbaError(
        addCourseInstructor(prisma, {
          termId,
          courseCode: 'CS ZG501',
          email: `nobody.${RUN}@test.local`,
          isLead: false,
          actorId,
        }),
        'user_not_found',
      );
      await expectDibbaError(
        addCourseInstructor(prisma, {
          termId,
          courseCode: 'CS ZG501',
          email: INACTIVE_EMAIL,
          isLead: false,
          actorId,
        }),
        'user_not_found',
      );
      await expectDibbaError(
        addCourseInstructor(prisma, {
          termId,
          courseCode: 'CS ZG501 and SS ZG527',
          email: FAC1_EMAIL,
          isLead: false,
          actorId,
        }),
        'invalid_input',
      );
      await expectDibbaError(
        addCourseInstructor(prisma, {
          termId,
          courseCode: 'nothing here',
          email: FAC1_EMAIL,
          isLead: false,
          actorId,
        }),
        'invalid_input',
      );
      expect(await prisma.courseInstructor.count({ where: { termId } })).toBe(1);

      await removeCourseInstructor(prisma, { id: added.id, actorId });
      expect(await prisma.courseInstructor.count({ where: { termId } })).toBe(0);
      await expectDibbaError(
        removeCourseInstructor(prisma, { id: added.id, actorId }),
        'not_found',
      );
      expect(
        await prisma.auditLog.count({
          where: {
            action: { in: ['dibba.instructor.add', 'dibba.instructor.remove'] },
            entityId: added.id,
          },
        }),
      ).toBe(2);
    },
  );

  integ('thrown DibbaErrors carry the code the UI maps', async () => {
    const err = await addCourseInstructor(prisma, {
      termId: 'clzzzzzzzzzzzzzzzzzzzzzzz',
      courseCode: 'CS ZG501',
      email: FAC1_EMAIL,
      isLead: false,
      actorId,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DibbaError);
    expect((err as DibbaError).code).toBe('not_found');
  });
});

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma, RoleName } from '@hmp/db';

// DB-touching integration test for "Create request" from the Course Dibba when no course
// offering exists (Handout Library review, 5 Nov 2026). Skipped without DATABASE_URL. Uses a
// far-future term and its own QZ* programmes / codes, all deleted in afterAll.

const hasDb = Boolean(process.env.DATABASE_URL);
const YEAR = 7123;
const TAG = '__dibba_offering_test__';

const { session, RedirectTo } = vi.hoisted(() => {
  class RedirectTo extends Error {
    constructor(public url: string) {
      super(`redirect ${url}`);
    }
  }
  return { session: { user: null as unknown }, RedirectTo };
});

vi.mock('@hmp/auth', async () => {
  const rbac = await import('@hmp/auth/src/rbac');
  return { getSessionUser: async () => session.user, requireRole: rbac.requireRole };
});
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new RedirectTo(url);
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

import { setUpOfferingAction } from '../actions';

const form = (o: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(o)) fd.set(k, v);
  return fd;
};

describe.skipIf(!hasDb)('setUpOfferingAction — course offering from the Course Dibba', () => {
  let icId = '';
  let semesterA = '';
  const codes = ['QZTA ZC901', 'QZTB ZC901'];

  beforeAll(async () => {
    const ic = await prisma.user.upsert({
      where: { email: `${TAG}@hmp.local` },
      update: {},
      create: { email: `${TAG}@hmp.local`, name: 'Dibba Offering Test IC' },
    });
    icId = ic.id;
    const term = await prisma.academicTerm.create({
      data: {
        name: `${TAG} ${YEAR}`,
        year: YEAR,
        term: 'FIRST',
        startDate: new Date(`${YEAR}-08-01`),
        endDate: new Date(`${YEAR}-12-15`),
      },
    });
    const entry = (
      courseCode: string,
      programmeCode: string,
      courseTitle: string,
      slotNo: number,
    ) => ({
      programmeCode,
      programmeTitle: `${programmeCode} test`,
      slotNo,
      slotDay: 'SAT',
      slotSession: 'FN',
      courseCode,
      courseTitle,
      rawCell: courseCode,
    });
    await prisma.dibbaImport.create({
      data: {
        termId: term.id,
        label: TAG,
        sourceFilename: `${TAG}.docx`,
        sourceFormat: 'docx',
        status: 'PUBLISHED',
        publishedAt: new Date(),
        rowCount: 3,
        uploadedById: ic.id,
        entries: {
          create: [
            entry('QZTA ZC901', 'QZ7123A', 'TEST MATERIALS', 1),
            entry('QZTB ZC901', 'QZ7123B', 'TEST MATERIALS', 1),
            entry('QZTC ZC902', 'QZ7123B', 'ONLY IN B', 2),
          ],
        },
      },
    });
    const a = await prisma.programme.create({
      data: {
        code: 'QZ7123A',
        name: 'Dibba offering test A',
        semesters: {
          create: {
            name: `Sem-I ${YEAR}`,
            year: YEAR,
            term: 'FIRST',
            startDate: new Date(`${YEAR}-08-01`),
            endDate: new Date(`${YEAR}-12-15`),
          },
        },
      },
      include: { semesters: true },
    });
    semesterA = a.semesters[0]!.id;
    await prisma.programme.create({ data: { code: 'QZ7123B', name: 'Dibba offering test B' } });
  });

  afterAll(async () => {
    const courses = await prisma.course.findMany({
      where: { bitsCourseNumber: { startsWith: 'QZT' } },
      select: { id: true, offerings: { select: { id: true } } },
    });
    const offeringIds = courses.flatMap((c) => c.offerings.map((o) => o.id));
    await prisma.auditLog.deleteMany({
      where: { entityId: { in: [...courses.map((c) => c.id), ...offeringIds] } },
    });
    await prisma.courseOffering.deleteMany({ where: { id: { in: offeringIds } } });
    await prisma.course.deleteMany({ where: { id: { in: courses.map((c) => c.id) } } });
    await prisma.programme.deleteMany({ where: { code: { in: ['QZ7123A', 'QZ7123B'] } } });
    await prisma.dibbaImport.deleteMany({ where: { label: TAG } });
    await prisma.academicTerm.deleteMany({ where: { name: `${TAG} ${YEAR}` } });
    await prisma.user.deleteMany({ where: { email: `${TAG}@hmp.local` } });
  });

  const asRole = (role: RoleName) => {
    session.user = {
      id: icId,
      email: `${TAG}@hmp.local`,
      name: 'Test',
      roles: [role],
      permissions: [],
    };
  };

  it('refuses anyone but the Instruction Cell / Admin, and writes nothing', async () => {
    asRole(RoleName.FACULTY);
    await expect(
      setUpOfferingAction(
        form({ courses: codes.join(','), term: `${YEAR}-FIRST`, semesterId: semesterA }),
      ),
    ).rejects.toThrow(/Forbidden/);
    expect(await prisma.course.count({ where: { bitsCourseNumber: { startsWith: 'QZT' } } })).toBe(
      0,
    );
  });

  it('semester missing: says so and creates nothing', async () => {
    asRole(RoleName.INSTRUCTION_CELL);
    const r = await setUpOfferingAction(
      form({ courses: 'QZTC ZC902', term: `${YEAR}-FIRST`, semesterId: semesterA }),
    );
    expect(r).toEqual({
      error: `Sem-I ${YEAR} isn't set up for programme QZ7123B yet — ask Admin to add it.`,
    });
    expect(await prisma.course.count({ where: { bitsCourseNumber: { startsWith: 'QZT' } } })).toBe(
      0,
    );
  });

  it('offering created: adds the course (all codes) and the offering, audit-logged', async () => {
    asRole(RoleName.INSTRUCTION_CELL);
    const err = await setUpOfferingAction(
      form({ courses: codes.join(','), term: `${YEAR}-FIRST`, semesterId: semesterA }),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RedirectTo);
    const url = new URL((err as InstanceType<typeof RedirectTo>).url, 'http://x');
    expect(url.pathname).toBe('/ic/requests/new');
    expect(url.searchParams.get('added')).toBe('1');

    const course = await prisma.course.findUniqueOrThrow({
      where: { bitsCourseNumber: 'QZTA ZC901' },
      include: { offerings: true },
    });
    expect(course).toMatchObject({
      code: 'QZTA ZC901',
      alternateCodes: ['QZTB ZC901'],
      title: 'Test Materials',
    });
    expect(course.offerings).toHaveLength(1);
    expect(course.offerings[0]).toMatchObject({
      id: url.searchParams.get('offering'),
      semesterId: semesterA,
      slotInfo: 'Slot 1 · Sat FN',
    });
    const audits = await prisma.auditLog.findMany({
      where: { entityId: { in: [course.id, course.offerings[0]!.id] } },
      select: { action: true, actorId: true },
    });
    expect(audits.map((a) => a.action).sort()).toEqual([
      'course.create_from_dibba',
      'offering.create_from_dibba',
    ]);
    expect(audits.every((a) => a.actorId === icId)).toBe(true);
  });

  it('offering exists: reuses it, changes nothing, logs nothing new (Admin may do it too)', async () => {
    asRole(RoleName.ADMIN);
    const before = await prisma.course.findUniqueOrThrow({
      where: { bitsCourseNumber: 'QZTA ZC901' },
      include: { offerings: true },
    });
    const err = await setUpOfferingAction(
      form({ courses: codes.join(','), term: `${YEAR}-FIRST`, semesterId: semesterA }),
    ).catch((e: unknown) => e);
    const url = new URL((err as InstanceType<typeof RedirectTo>).url, 'http://x');
    expect(url.searchParams.get('added')).toBe('0');
    expect(url.searchParams.get('offering')).toBe(before.offerings[0]!.id);
    const after = await prisma.course.findUniqueOrThrow({
      where: { bitsCourseNumber: 'QZTA ZC901' },
      include: { offerings: true },
    });
    expect(after).toEqual(before);
    expect(
      await prisma.auditLog.count({
        where: { entityId: { in: [before.id, before.offerings[0]!.id] } },
      }),
    ).toBe(2);
  });
});

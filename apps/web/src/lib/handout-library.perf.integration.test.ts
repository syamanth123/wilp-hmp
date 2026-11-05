import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FacultyType, HandoutStatus, RoleName, prisma } from '@hmp/db';
import { loadLibraryFromAddress } from './handout-library-load';

/**
 * Handout Library timing (plan §2, decision D4): the list must answer in under 500 ms with 1,000
 * handouts. Seeds 1,000 requests (500 courses × 2 semesters, every status) in a throw-away
 * programme, times the Instruction Cell's default view and a filtered search, then deletes it all.
 * Probe-skips without a seeded database. Rows use the sentinel year 7777 (refNo HMP-7777-…,
 * semesters 7777) so they can never touch real data, and leftovers from a crashed run are cleared
 * first.
 */

const REF = 'HMP-7777-';
const PROG = 'LIBPERF-7777';
const N_COURSES = 500;
const STATUSES = [
  HandoutStatus.REQUESTED,
  HandoutStatus.ALLOCATED,
  HandoutStatus.ASSIGNED,
  HandoutStatus.IN_PROGRESS,
  HandoutStatus.SME_REVIEW,
  HandoutStatus.SUBMITTED,
  HandoutStatus.UNDER_REVIEW,
  HandoutStatus.REWORK_REQUESTED,
  HandoutStatus.APPROVED,
  HandoutStatus.PUBLISHED,
];
const code = (i: number) => `PF ZG${String(i).padStart(3, '0')}`;

/** A realistic handout body (12 sessions, 6 objectives…) so the compare cost is honest. */
const body = (i: number, variant: number) => ({
  schemaVersion: 1,
  metadata: {
    institutionHeader: 'BITS Pilani',
    divisionHeader: 'WILP',
    semester: 'First Semester 7777-7778',
    documentTitle: 'Course Handout',
    formNumber: '',
  },
  partA: {
    courseTitle: `Performance course ${i}`,
    courseNumbers: [code(i)],
    creditModel: { description: '3-1-1' },
    instructors: ['Dr. Perf'],
    date: '01-08-2025',
    courseDescription: `<p>${'This course covers the essentials of the subject in depth. '.repeat(6)}${variant}</p>`,
    courseObjectives: Array.from({ length: 6 }, (_, k) => ({
      code: `CO${k + 1}`,
      description: `Objective ${k + 1} about topic ${(k + variant) % 9} with detail and context`,
    })),
    textBooks: [{ code: 'T1', citation: 'A standard text book, 3rd edition, Publisher, 2020' }],
    referenceBooks: [{ code: 'R1', citation: 'A reference book, 2nd edition' }],
    learningOutcomes: Array.from({ length: 5 }, (_, k) => ({
      code: `LO${k + 1}`,
      description: `Outcome ${k + 1}, variant ${(k * variant) % 4}`,
    })),
  },
  partB: {
    sessions: Array.from({ length: 12 }, (_, k) => ({
      sessionNumber: String(k + 1),
      topicTitle: `Topic ${k + 1}${k < variant * 4 ? ' (revised)' : ''}`,
      subTopics: 'first point; second point; third point; fourth point',
      references: ['T1'],
    })),
  },
  evaluation: {
    legend: '',
    components: [
      {
        ecNumber: 'EC-1',
        subComponents: [{ name: 'Quiz', type: 'Online', weight: 30, duration: '1h' }],
      },
      {
        ecNumber: 'EC-2',
        subComponents: [{ name: 'Mid-sem', type: 'Closed', weight: 30, duration: '2h' }],
      },
      {
        ecNumber: 'EC-3',
        subComponents: [{ name: 'Compre', type: 'Open', weight: 40, duration: '3h' }],
      },
    ],
    notes: '<p>Notes.</p>',
    midSemSyllabus: '<p>Sessions 1-6</p>',
    compreSyllabus: '<p>All sessions</p>',
  },
  importantLinks: {
    elearnPortalUrl: 'https://elearn.bits-pilani.ac.in',
    elearnPortalNote: '',
    contactSessionsNote: '',
  },
  evaluationGuidelines: '<p>Guidelines.</p>',
});

let ready = false;
let ic: { id: string; roles: RoleName[] } | null = null;

async function cleanup() {
  await prisma.handoutRequest.deleteMany({ where: { refNo: { startsWith: REF } } });
  await prisma.courseOffering.deleteMany({ where: { semester: { programme: { code: PROG } } } });
  await prisma.course.deleteMany({ where: { bitsCourseNumber: { startsWith: 'PF ZG' } } });
  await prisma.semester.deleteMany({ where: { programme: { code: PROG } } });
  await prisma.programme.deleteMany({ where: { code: PROG } });
}

beforeAll(async () => {
  try {
    const [icUser, faculty] = await Promise.all([
      prisma.user.findUnique({ where: { email: 'ic@hmp.local' }, select: { id: true } }),
      prisma.user.findUnique({ where: { email: 'faculty@hmp.local' }, select: { id: true } }),
    ]);
    if (!icUser || !faculty) return;
    await cleanup();
    const programme = await prisma.programme.create({ data: { code: PROG, name: 'Perf test' } });
    const sems = await Promise.all(
      (['FIRST', 'SECOND'] as const).map((term, i) =>
        prisma.semester.create({
          data: {
            programmeId: programme.id,
            name: `Perf ${term}`,
            year: 7777,
            term,
            startDate: new Date(Date.UTC(7777, i * 6, 1)),
            endDate: new Date(Date.UTC(7777, i * 6 + 5, 1)),
          },
        }),
      ),
    );
    await prisma.course.createMany({
      data: Array.from({ length: N_COURSES }, (_, i) => ({
        bitsCourseNumber: code(i),
        code: code(i),
        title: `Performance course ${i}`,
      })),
    });
    const courses = await prisma.course.findMany({
      where: { bitsCourseNumber: { startsWith: 'PF ZG' } },
      select: { id: true },
    });
    await prisma.courseOffering.createMany({
      data: sems.flatMap((s) => courses.map((c) => ({ courseId: c.id, semesterId: s.id }))),
    });
    const offerings = await prisma.courseOffering.findMany({
      where: { semesterId: { in: sems.map((s) => s.id) } },
      select: { id: true },
    });
    await prisma.handoutRequest.createMany({
      data: offerings.map((o, i) => ({
        refNo: `${REF}${String(i).padStart(5, '0')}`,
        courseOfferingId: o.id,
        initiatedById: icUser.id,
        status: STATUSES[i % STATUSES.length]!,
      })),
    });
    const reqs = await prisma.handoutRequest.findMany({
      where: { refNo: { startsWith: REF } },
      select: { id: true, refNo: true },
    });
    // Every handout gets a structured current version (the FIRST-semester ones are "last year").
    await prisma.handout.createMany({ data: reqs.map((r) => ({ requestId: r.id })) });
    const handouts = await prisma.handout.findMany({
      where: { requestId: { in: reqs.map((r) => r.id) } },
      select: { id: true, requestId: true },
    });
    const idx = new Map(reqs.map((r) => [r.id, Number(r.refNo.slice(REF.length))]));
    await prisma.handoutVersion.createMany({
      data: handouts.map((h) => {
        const i = idx.get(h.requestId)!;
        return {
          handoutId: h.id,
          versionNo: 1,
          contentHtml: '',
          data: body(i % N_COURSES, i < N_COURSES ? 0 : i % 4),
          authorId: faculty.id,
        };
      }),
    });
    await prisma.$executeRaw`
      UPDATE "Handout" h SET "currentVersionId" = v.id
      FROM "HandoutVersion" v
      WHERE v."handoutId" = h.id AND h."requestId" IN (SELECT id FROM "HandoutRequest" WHERE "refNo" LIKE 'HMP-7777-%')`;
    await prisma.facultyAssignment.createMany({
      data: reqs.map((r) => ({
        requestId: r.id,
        facultyId: faculty.id,
        facultyType: FacultyType.ON_CAMPUS,
      })),
    });
    ic = { id: icUser.id, roles: [RoleName.INSTRUCTION_CELL] };
    ready = reqs.length === 1000;
  } catch (err) {
    console.warn('[library perf] skipped — no seeded database:', (err as Error).message);
  }
}, 120_000);

afterAll(async () => {
  if (ic) await cleanup();
});

async function time(sp: Record<string, string>): Promise<{ ms: number; total: number }> {
  await loadLibraryFromAddress(ic!, sp); // warm-up (connection pool, query plans)
  const runs: number[] = [];
  let total = 0;
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    const lib = await loadLibraryFromAddress(ic!, sp);
    runs.push(performance.now() - t);
    total = lib.totalItems;
  }
  return { ms: Math.min(...runs), total };
}

describe('Handout Library with 1,000 handouts', () => {
  it('opens the default view in under 500 ms', async (ctx) => {
    if (!ready) return ctx.skip();
    const r = await time({ tab: 'in-progress', term: 'all' });
    console.log(
      `[library perf] in progress, all semesters: ${r.ms.toFixed(0)} ms, ${r.total} rows`,
    );
    expect(r.total).toBeGreaterThanOrEqual(800);
    expect(r.ms).toBeLessThan(500);
  });

  it('searches and filters in under 500 ms', async (ctx) => {
    if (!ready) return ctx.skip();
    const r = await time({ tab: 'published', term: 'all', q: 'pf zg 12', status: 'published' });
    console.log(`[library perf] published search: ${r.ms.toFixed(0)} ms, ${r.total} rows`);
    expect(r.ms).toBeLessThan(500);
  });

  it('reports the on-demand "changed vs last year" cost (decision D4)', async (ctx) => {
    if (!ready) return ctx.skip();
    const hog = { id: ic!.id, roles: [RoleName.HOG] };
    const t0 = performance.now();
    await loadLibraryFromAddress(hog, { tab: 'in-progress', view: 'changed-a-lot' });
    const t1 = performance.now();
    const lib = await loadLibraryFromAddress(hog, { tab: 'in-progress', view: 'changed-a-lot' });
    const r = { ms: Math.min(t1 - t0, performance.now() - t1), total: lib.totalItems };
    console.log(
      `[library perf] changed vs last year (on demand, ~800 compared): ${r.ms.toFixed(0)} ms, ${r.total} changed a lot`,
    );
    // Reported, not asserted: if this passes 500 ms the decision is the user's (stored value).
    expect(r.ms).toBeGreaterThan(0);
  });
});

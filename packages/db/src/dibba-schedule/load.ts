import { DibbaImportStatus, HandoutStatus, type PrismaClient } from '@prisma/client';
import { findCatalogueCourses } from '../dibba-import/import-action';
import {
  buildSchedule,
  EMPTY_SCHEDULE,
  expandEquivalentCodes,
  pickActiveTerm,
  type FacultySchedule,
  type InstructorLike,
  type InstructorSourceKind,
  type PublishedImportRef,
  type ScheduleTerm,
} from './index';

/**
 * Prisma loaders for the faculty schedule (Phase 5, plan D1–D3). Every query is
 * keyed by the SESSION user's id — callers pass `me.id`, never a URL value.
 */

export interface ActiveTerm extends ScheduleTerm {
  published: PublishedImportRef | null;
}

/** The term faculty should be looking at (plan D2); null when nothing is published. */
export async function loadActiveTerm(
  prisma: PrismaClient,
  now = new Date(),
): Promise<ActiveTerm | null> {
  const terms = await prisma.academicTerm.findMany({
    select: {
      id: true,
      name: true,
      year: true,
      term: true,
      startDate: true,
      endDate: true,
      imports: {
        where: { status: DibbaImportStatus.PUBLISHED },
        select: { id: true, label: true, publishedAt: true },
        take: 1,
      },
    },
  });
  const picked = pickActiveTerm(
    terms.map((t) => ({ ...t, hasPublished: t.imports.length > 0 })),
    now,
  );
  if (!picked) return null;
  const { imports, hasPublished: _hasPublished, ...term } = picked;
  return { ...term, published: imports[0] ?? null };
}

export interface LoadFacultyScheduleArgs {
  userId: string;
  now?: Date;
}

/** Everything /faculty/schedule shows for ONE user (plan D3–D6). */
export async function loadFacultySchedule(
  prisma: PrismaClient,
  args: LoadFacultyScheduleArgs,
): Promise<FacultySchedule> {
  const now = args.now ?? new Date();
  const active = await loadActiveTerm(prisma, now);
  if (!active || !active.published) return { ...EMPTY_SCHEDULE, term: active };
  const { published, ...term } = active;

  // Source 1: my active HMP assignments in this term's (year, term).
  // Source 2: my CourseInstructor rows for the term (sheet or manual).
  const [assignments, instructorRows] = await Promise.all([
    prisma.facultyAssignment.findMany({
      where: {
        facultyId: args.userId,
        active: true,
        request: {
          status: { notIn: [HandoutStatus.REJECTED, HandoutStatus.ARCHIVED] },
          offering: { semester: { year: term.year, term: term.term } },
        },
      },
      select: {
        request: {
          select: {
            offering: {
              select: { course: { select: { bitsCourseNumber: true, alternateCodes: true } } },
            },
          },
        },
      },
    }),
    prisma.courseInstructor.findMany({
      where: { termId: term.id, userId: args.userId },
      select: { courseCode: true },
    }),
  ]);

  const sources = new Map<string, Set<InstructorSourceKind>>();
  const add = (code: string, kind: InstructorSourceKind) => {
    const key = code.trim().toUpperCase().replace(/\s+/g, ' ');
    const set = sources.get(key) ?? new Set<InstructorSourceKind>();
    set.add(kind);
    sources.set(key, set);
  };
  for (const a of assignments) {
    const c = a.request.offering.course;
    add(c.bitsCourseNumber, 'assignment');
    for (const alt of c.alternateCodes) add(alt, 'assignment');
  }
  for (const r of instructorRows) add(r.courseCode, 'instructor');
  if (sources.size === 0) return { ...EMPTY_SCHEDULE, term, published };

  // Equivalent codes (plan D4): a sheet row on SS ZC111 must also pull AAOC ZC111 rows.
  const catalogue = await findCatalogueCourses(prisma, [...sources.keys()]);
  const codes = expandEquivalentCodes(sources.keys(), catalogue);
  for (const code of codes) {
    if (!sources.has(code)) {
      // Inherit the source(s) of the code it is equivalent to.
      const inherited = new Set<InstructorSourceKind>();
      for (const c of catalogue) {
        const all = [c.bitsCourseNumber, ...c.alternateCodes].map((x) => x.toUpperCase());
        if (!all.includes(code)) continue;
        for (const a of all) for (const s of sources.get(a) ?? []) inherited.add(s);
      }
      if (inherited.size > 0) sources.set(code, inherited);
    }
  }

  const codeList = [...codes];
  const [entries, instructors, assignmentPeers, timings, examDates] = await Promise.all([
    prisma.dibbaEntry.findMany({
      where: { importId: published.id, courseCode: { in: codeList } },
      select: {
        courseCode: true,
        courseTitle: true,
        slotNo: true,
        slotDay: true,
        slotSession: true,
        programmeCode: true,
        programmeTitle: true,
        admitBatch: true,
        studentCount: true,
        isBacklogRow: true,
        classTimeHint: true,
      },
      orderBy: [
        { courseCode: 'asc' },
        { slotNo: 'asc' },
        { programmeCode: 'asc' },
        { admitBatch: 'asc' },
      ],
    }),
    prisma.courseInstructor.findMany({
      where: { termId: term.id, courseCode: { in: codeList } },
      select: { courseCode: true, userId: true, isLead: true, user: { select: { name: true } } },
    }),
    prisma.facultyAssignment.findMany({
      where: {
        active: true,
        request: {
          status: { notIn: [HandoutStatus.REJECTED, HandoutStatus.ARCHIVED] },
          offering: {
            semester: { year: term.year, term: term.term },
            course: {
              OR: [
                { bitsCourseNumber: { in: codeList } },
                { alternateCodes: { hasSome: codeList } },
              ],
            },
          },
        },
      },
      select: {
        facultyId: true,
        faculty: { select: { name: true } },
        request: {
          select: { offering: { select: { course: { select: { bitsCourseNumber: true } } } } },
        },
      },
    }),
    prisma.slotTiming.findMany({ where: { termId: term.id } }),
    prisma.slotExamDate.findMany({ where: { termId: term.id } }),
  ]);

  const instructorLikes: InstructorLike[] = [
    ...instructors.map((i) => ({
      courseCode: i.courseCode,
      userId: i.userId,
      userName: i.user.name,
      isLead: i.isLead,
    })),
    ...assignmentPeers.map((a) => ({
      courseCode: a.request.offering.course.bitsCourseNumber,
      userId: a.facultyId,
      userName: a.faculty.name,
      isLead: false,
    })),
  ];

  return buildSchedule({
    term,
    published,
    entries,
    sources,
    instructors: instructorLikes,
    myUserId: args.userId,
    catalogue,
    timings,
    examDates,
  });
}

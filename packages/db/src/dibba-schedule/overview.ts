import { DibbaImportStatus, HandoutStatus, type PrismaClient } from '@prisma/client';
import { STANDARD_SLOTS } from '../dibba-slots';
import { buildGroupKeys, expandEquivalentCodes, type CatalogueCourseLike } from './index';

/**
 * Course Dibba — term overview for HOG / PC / IC (Phase 6, plan §5 of the
 * Phase 5 plan; spec §7). buildTermOverview() is PURE and unit-tested;
 * loadTermOverview() fetches the rows. Never filtered by the viewer: these
 * roles see the whole term. Grouping uses the same buildGroupKeys() as the
 * faculty page, so the two never disagree about what is one course.
 */

export interface OverviewEntry {
  courseCode: string;
  courseTitle: string;
  slotNo: number;
  programmeCode: string;
  studentCount: number | null;
  courseId: string | null;
}

export interface OverviewInstructor {
  courseCode: string;
  userId: string;
  name: string;
  facultyType: string | null;
  source: 'assignment' | 'sheet' | 'manual';
  isLead: boolean;
}

export interface OverviewOffering {
  courseCode: string;
  slotInfo: string | null;
  semesterName: string;
  programmeCode: string;
}

export interface OverviewCourse {
  code: string;
  title: string;
  slotNos: number[];
  programmes: string[];
  students: number;
  /** Everyone on this code OR an equivalent code (catalogue alternate / same title). */
  instructors: Array<{
    userId: string;
    name: string;
    source: OverviewInstructor['source'];
    isLead: boolean;
  }>;
  inCatalogue: boolean;
}

export interface OverviewFaculty {
  userId: string;
  name: string;
  facultyType: string | null;
  /** Distinct courses after equivalent-code merging. */
  courseCount: number;
  codes: string[];
}

export interface OverviewClash {
  userId: string;
  name: string;
  slotNo: number;
  day: string | null;
  session: string | null;
  codes: string[];
}

export interface SlotDrift {
  code: string;
  title: string;
  dibbaSlots: number[];
  slotInfo: string;
  semesterName: string;
  programmeCode: string;
}

export interface TermOverview {
  courses: OverviewCourse[];
  faculty: OverviewFaculty[];
  programmes: string[];
  clashes: OverviewClash[];
  uncovered: OverviewCourse[];
  offCampusLoad: Array<OverviewFaculty & { limit: number }>;
  slotDrift: SlotDrift[];
  notInCatalogue: Array<{ code: string; title: string }>;
}

export interface BuildTermOverviewInput {
  entries: OverviewEntry[];
  instructors: OverviewInstructor[];
  offerings: OverviewOffering[];
  catalogue: CatalogueCourseLike[];
  offCampusMaxCourses: number;
}

const normCode = (c: string): string => c.trim().toUpperCase().replace(/\s+/g, ' ');

/**
 * Slot number stated by a free-text `CourseOffering.slotInfo`, or null. Only an
 * explicit slot reference counts: "SL3", "Slot 3", "S3", a bare "3", or a
 * day + session pair ("SAT AN", "Sunday EN"). Times and other digits ("Sat 2-5 PM",
 * "SAT 8:20", "Group 3") are NOT slot numbers.
 */
export function slotNoFromSlotInfo(slotInfo: string): number | null {
  const text = slotInfo.trim();
  const explicit = /(?:^|[^A-Z0-9])S(?:L|LOT)?[ -]?([1-8])(?![0-9:.])/i.exec(text);
  if (explicit) return Number(explicit[1]);
  if (/^[1-8]$/.test(text)) return Number(text);
  const day = /(?:^|[^A-Z])(SAT|SUN|FRI)/i.exec(text)?.[1]?.toUpperCase();
  const session = /(?:^|[^A-Z])(FN|AN|EV|EN)(?![A-Z])/i
    .exec(text)?.[1]
    ?.toUpperCase()
    .replace('EN', 'EV');
  if (day && session) {
    return STANDARD_SLOTS.find((s) => s.day === day && s.session === session)?.slotNo ?? null;
  }
  return null;
}

export function buildTermOverview(input: BuildTermOverviewInput): TermOverview {
  const groupKeys = buildGroupKeys(input.entries, input.catalogue);

  // Courses by code.
  type CourseDraft = OverviewCourse & { programmeSet: Set<string>; slotSet: Set<number> };
  const byCode = new Map<string, CourseDraft>();
  for (const e of input.entries) {
    const code = normCode(e.courseCode);
    let c = byCode.get(code);
    if (!c) {
      c = {
        code,
        title: e.courseTitle,
        slotNos: [],
        programmes: [],
        students: 0,
        instructors: [],
        inCatalogue: e.courseId !== null,
        programmeSet: new Set(),
        slotSet: new Set(),
      };
      byCode.set(code, c);
    }
    c.inCatalogue = c.inCatalogue || e.courseId !== null;
    c.slotSet.add(e.slotNo);
    c.programmeSet.add(e.programmeCode);
    c.students += e.studentCount ?? 0;
  }
  const codesByGroup = new Map<string, string[]>();
  for (const code of byCode.keys()) {
    const key = groupKeys.get(code)!;
    const list = codesByGroup.get(key) ?? [];
    list.push(code);
    codesByGroup.set(key, list);
  }

  // Instructors per GROUP (an instructor on any equivalent code covers the course),
  // one row per person; isLead sticks.
  type Person = OverviewCourse['instructors'][number];
  const instructorsByGroup = new Map<string, Map<string, Person>>();
  type FacultyDraft = OverviewFaculty & {
    groupKeys: Set<string>;
    slotsByGroup: Map<string, Set<number>>;
  };
  const facultyMap = new Map<string, FacultyDraft>();
  for (const i of input.instructors) {
    const code = normCode(i.courseCode);
    const course = byCode.get(code);
    if (!course) continue; // teaches a code that is not in this Dibba
    const key = groupKeys.get(code)!;
    const perGroup = instructorsByGroup.get(key) ?? new Map<string, Person>();
    const cur = perGroup.get(i.userId);
    if (!cur)
      perGroup.set(i.userId, {
        userId: i.userId,
        name: i.name,
        source: i.source,
        isLead: i.isLead,
      });
    else if (i.isLead) cur.isLead = true;
    instructorsByGroup.set(key, perGroup);

    let f = facultyMap.get(i.userId);
    if (!f) {
      f = {
        userId: i.userId,
        name: i.name,
        facultyType: i.facultyType,
        courseCount: 0,
        codes: [],
        groupKeys: new Set(),
        slotsByGroup: new Map(),
      };
      facultyMap.set(i.userId, f);
    }
    f.groupKeys.add(key);
    if (!f.codes.includes(code)) f.codes.push(code);
    const slots = f.slotsByGroup.get(key) ?? new Set<number>();
    for (const s of course.slotSet) if (s >= 1) slots.add(s);
    f.slotsByGroup.set(key, slots);
  }

  const courses: OverviewCourse[] = [...byCode.values()]
    .map((c) => ({
      code: c.code,
      title: c.title,
      slotNos: [...c.slotSet].sort((a, b) => a - b),
      programmes: [...c.programmeSet].sort(),
      students: c.students,
      instructors: [...(instructorsByGroup.get(groupKeys.get(c.code)!)?.values() ?? [])].sort(
        (a, b) => a.name.localeCompare(b.name),
      ),
      inCatalogue: c.inCatalogue,
    }))
    .sort((a, b) => a.code.localeCompare(b.code));

  const programmes = [...new Set(input.entries.map((e) => e.programmeCode))].sort();

  // Clashes: per faculty, per slot, two different course groups.
  const clashes: OverviewClash[] = [];
  const faculty: OverviewFaculty[] = [];
  for (const f of facultyMap.values()) {
    const groupsBySlot = new Map<number, Set<string>>();
    for (const [key, slots] of f.slotsByGroup) {
      for (const s of slots) {
        const set = groupsBySlot.get(s) ?? new Set<string>();
        set.add(key);
        groupsBySlot.set(s, set);
      }
    }
    for (const [slotNo, keys] of [...groupsBySlot.entries()].sort((a, b) => a[0] - b[0])) {
      if (keys.size < 2) continue;
      const std = STANDARD_SLOTS.find((s) => s.slotNo === slotNo);
      const codes = [...keys]
        .flatMap((k) => codesByGroup.get(k) ?? [])
        .filter((c) => byCode.get(c)!.slotSet.has(slotNo))
        .sort();
      clashes.push({
        userId: f.userId,
        name: f.name,
        slotNo,
        day: std?.day ?? null,
        session: std?.session ?? null,
        codes,
      });
    }
    faculty.push({
      userId: f.userId,
      name: f.name,
      facultyType: f.facultyType,
      courseCount: f.groupKeys.size,
      codes: [...f.codes].sort(),
    });
  }
  faculty.sort((a, b) => a.name.localeCompare(b.name));
  clashes.sort((a, b) => a.name.localeCompare(b.name) || a.slotNo - b.slotNo);

  const uncovered = courses.filter(
    (c) => c.instructors.length === 0 && c.slotNos.some((s) => s >= 1),
  );

  const offCampusLoad = faculty
    .filter((f) => f.facultyType === 'OFF_CAMPUS' && f.courseCount > input.offCampusMaxCourses)
    .map((f) => ({ ...f, limit: input.offCampusMaxCourses }));

  const slotDrift: SlotDrift[] = [];
  for (const o of input.offerings) {
    if (!o.slotInfo) continue;
    const course = byCode.get(normCode(o.courseCode));
    if (!course) continue;
    const stated = slotNoFromSlotInfo(o.slotInfo);
    if (stated === null) continue;
    const dibbaSlots = [...course.slotSet].filter((s) => s >= 1);
    if (dibbaSlots.length === 0 || dibbaSlots.includes(stated)) continue;
    slotDrift.push({
      code: course.code,
      title: course.title,
      dibbaSlots: dibbaSlots.sort((a, b) => a - b),
      slotInfo: o.slotInfo,
      semesterName: o.semesterName,
      programmeCode: o.programmeCode,
    });
  }
  slotDrift.sort((a, b) => a.code.localeCompare(b.code));

  const notInCatalogue = courses
    .filter((c) => !c.inCatalogue)
    .map((c) => ({ code: c.code, title: c.title }));

  return {
    courses,
    faculty,
    programmes,
    clashes,
    uncovered,
    offCampusLoad,
    slotDrift,
    notInCatalogue,
  };
}

export interface LoadTermOverviewArgs {
  termId: string;
}

export interface LoadedTermOverview extends TermOverview {
  term: { id: string; name: string; year: number; term: string; startDate: Date; endDate: Date };
  published: { id: string; label: string; publishedAt: Date | null } | null;
  offCampusMaxCourses: number;
}

/** The whole term for HOG / PC / IC (not filtered by viewer). Null when the term does not exist. */
export async function loadTermOverview(
  prisma: PrismaClient,
  args: LoadTermOverviewArgs,
): Promise<LoadedTermOverview | null> {
  const term = await prisma.academicTerm.findUnique({
    where: { id: args.termId },
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
  if (!term) return null;
  const { imports, ...termRow } = term;
  const published = imports[0] ?? null;
  const config = await prisma.workflowConfig.findFirst({ select: { offCampusMaxCourses: true } });
  const offCampusMaxCourses = config?.offCampusMaxCourses ?? 3;
  if (!published) {
    return {
      term: termRow,
      published: null,
      offCampusMaxCourses,
      ...buildTermOverview({
        entries: [],
        instructors: [],
        offerings: [],
        catalogue: [],
        offCampusMaxCourses,
      }),
    };
  }

  const entries = await prisma.dibbaEntry.findMany({
    where: { importId: published.id },
    select: {
      courseCode: true,
      courseTitle: true,
      slotNo: true,
      programmeCode: true,
      studentCount: true,
      courseId: true,
    },
  });
  const codes = [...new Set(entries.map((e) => e.courseCode))];

  const [instructorRows, assignments, offerings, catalogue] = await Promise.all([
    prisma.courseInstructor.findMany({
      where: { termId: term.id },
      select: {
        courseCode: true,
        userId: true,
        isLead: true,
        source: true,
        user: { select: { name: true, facultyType: true } },
      },
    }),
    prisma.facultyAssignment.findMany({
      where: {
        active: true,
        request: {
          status: { notIn: [HandoutStatus.REJECTED, HandoutStatus.ARCHIVED] },
          offering: { semester: { year: term.year, term: term.term } },
        },
      },
      select: {
        facultyId: true,
        faculty: { select: { name: true, facultyType: true } },
        request: {
          select: {
            offering: {
              select: { course: { select: { bitsCourseNumber: true, alternateCodes: true } } },
            },
          },
        },
      },
    }),
    prisma.courseOffering.findMany({
      where: { semester: { year: term.year, term: term.term }, slotInfo: { not: null } },
      select: {
        slotInfo: true,
        course: { select: { bitsCourseNumber: true, alternateCodes: true } },
        semester: { select: { name: true, programme: { select: { code: true } } } },
      },
    }),
    prisma.course.findMany({
      where: { OR: [{ bitsCourseNumber: { in: codes } }, { alternateCodes: { hasSome: codes } }] },
      select: { bitsCourseNumber: true, alternateCodes: true },
    }),
  ]);

  const codeSet = new Set(codes.map(normCode));
  const instructors: OverviewInstructor[] = [];
  // Sheet / manual rows: a row on SS ZC447 also covers ES ZC447 when the catalogue
  // says they are one course (same expansion the faculty page applies).
  for (const r of instructorRows) {
    const source: OverviewInstructor['source'] =
      r.source === 'MANUAL' ? 'manual' : r.source === 'DIBBA_SHEET' ? 'sheet' : 'assignment';
    for (const code of expandEquivalentCodes([r.courseCode], catalogue)) {
      if (!codeSet.has(code)) continue;
      instructors.push({
        courseCode: code,
        userId: r.userId,
        name: r.user.name,
        facultyType: r.user.facultyType,
        source,
        isLead: r.isLead,
      });
    }
  }
  for (const a of assignments) {
    const c = a.request.offering.course;
    for (const code of [c.bitsCourseNumber, ...c.alternateCodes]) {
      if (!codeSet.has(normCode(code))) continue;
      instructors.push({
        courseCode: code,
        userId: a.facultyId,
        name: a.faculty.name,
        facultyType: a.faculty.facultyType,
        source: 'assignment',
        isLead: false,
      });
    }
  }
  const offeringLikes: OverviewOffering[] = [];
  for (const o of offerings) {
    for (const code of [o.course.bitsCourseNumber, ...o.course.alternateCodes]) {
      if (!codeSet.has(normCode(code))) continue;
      offeringLikes.push({
        courseCode: code,
        slotInfo: o.slotInfo,
        semesterName: o.semester.name,
        programmeCode: o.semester.programme.code,
      });
    }
  }

  return {
    term: termRow,
    published,
    offCampusMaxCourses,
    ...buildTermOverview({
      entries,
      instructors,
      offerings: offeringLikes,
      catalogue,
      offCampusMaxCourses,
    }),
  };
}

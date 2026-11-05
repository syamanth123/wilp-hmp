import { prisma, normalizeBitsCourseNumber, type Prisma } from '@hmp/db';
import { displayCourseTitle } from './course-title';
import { mixedCourseNumbers, termLabel } from './handout-library';
import { resolveDibbaProgramme } from './dibba-programme-codes';

/**
 * "Create request" for a course in the published Course Dibba that has no course offering yet
 * (Handout Library review, 5 Nov 2026). The Instruction Cell confirms, then HMP adds the course
 * (only if no code of the class is in the catalogue) and its offering in the programme's existing
 * semester, and opens the new-request page. Rules:
 * - the semester must already exist for that programme and term — never invented;
 * - create only: an existing course or offering is reused, never changed;
 * - a Dibba programme ("18BT/18ET") is the HMP programme Admin linked it to (Admin → Dibba
 *   programme codes, v1.3.0), else the one whose code is the whole string or one of its parts
 *   (lib/dibba-programme-codes.ts resolveDibbaProgramme).
 */

export interface DibbaRow {
  code: string;
  title: string;
  programmeCode: string;
  slotNo: number;
  slotDay: string | null;
  slotSession: string | null;
  catalogueTitle: string | null;
}

export interface ProgrammeRow {
  id: string;
  code: string;
  active: boolean;
  semesters: { id: string; name: string; year: number; term: string }[];
}

export interface CourseRow {
  id: string;
  bitsCourseNumber: string;
  code: string;
  alternateCodes: string[];
  title: string;
}

export interface PlanInput {
  /** The class's codes, lead first (as the library lists them). */
  codes: string[];
  year: number;
  term: string;
  /** The term's published Dibba rows for these codes. */
  rows: DibbaRow[];
  programmes: ProgrammeRow[];
  /** Admin's links: Dibba programme code → HMP programme id. */
  links: Record<string, string>;
  /** Catalogue courses carrying any of the codes. */
  courses: CourseRow[];
  offerings: { id: string; courseId: string; semesterId: string }[];
  /** "Sem-I 2025-26" — the term's name in messages. */
  semesterName: string;
}

export interface ProgrammeChoice {
  programmeId: string;
  programmeCode: string;
  /** The Dibba's code for it ("18BT/18ET"). */
  dibbaProgramme: string;
  semesterId: string;
  semesterName: string;
  /** Already offered there (nothing to add). */
  offeringId: string | null;
}

export type OfferingPlan =
  | { kind: 'not-in-dibba'; codes: string[]; semesterName: string }
  | { kind: 'invalid-code'; codes: string[]; semesterName: string; code: string }
  | {
      kind: 'not-set-up';
      codes: string[];
      semesterName: string;
      /** Dibba codes not linked to any HMP programme. */
      unlinked: string[];
      /** Dibba codes whose HMP programme has no semester for this term. */
      noSemester: string[];
    }
  | {
      kind: 'ready';
      codes: string[];
      title: string;
      semesterName: string;
      /** The catalogue course to use; null = it will be added. */
      course: CourseRow | null;
      /** Codes stored on a new course (lead first); codes that aren't course numbers are left off. */
      newCourseCodes: string[];
      skippedCodes: string[];
      choices: ProgrammeChoice[];
      /** Dibba programmes of the class that are unlinked or have no semester for this term. */
      notSetUp: string[];
      mixedNumbers: boolean;
      slotInfo: string | null;
    };

const DAY: Record<string, string> = { SAT: 'Sat', SUN: 'Sun', FRI: 'Fri' };

const strict = (code: string): string | null => {
  try {
    return normalizeBitsCourseNumber(code);
  } catch {
    return null;
  }
};

/** The HMP programme a Dibba programme code stands for: Admin's link, else a matching code. */
export function matchProgramme(
  dibbaCode: string,
  input: Pick<PlanInput, 'programmes' | 'links'>,
): ProgrammeRow | null {
  const byId = new Map(input.programmes.map((p) => [p.id, p]));
  const mappings = new Map(
    Object.entries(input.links).flatMap(([code, id]) =>
      byId.has(id) ? [[code, byId.get(id)!] as const] : [],
    ),
  );
  const r = resolveDibbaProgramme(dibbaCode, { mappings, programmes: input.programmes });
  return r.programme ? byId.get(r.programme.id)! : null;
}

/** What "Create request" would do for this class — no database access (unit-tested). */
export function planOffering(input: PlanInput): OfferingPlan {
  const inDibba = new Set(input.rows.map((r) => r.code));
  const codes = [...new Set(input.codes)].filter((c) => inDibba.has(c));
  const { semesterName } = input;
  if (codes.length === 0) return { kind: 'not-in-dibba', codes: input.codes, semesterName };

  const lead = codes[0]!;
  const course =
    input.courses.find((c) => c.bitsCourseNumber === lead || c.code === lead) ??
    input.courses.find((c) =>
      [c.bitsCourseNumber, c.code, ...c.alternateCodes].some((x) => codes.includes(x)),
    ) ??
    null;

  let newCourseCodes: string[] = [];
  let skippedCodes: string[] = [];
  if (!course) {
    if (!strict(lead)) return { kind: 'invalid-code', codes, semesterName, code: lead };
    newCourseCodes = codes.filter((c) => strict(c)).map((c) => strict(c)!);
    skippedCodes = codes.filter((c) => !strict(c));
  }

  const dibbaProgrammes = [
    ...new Set(input.rows.filter((r) => codes.includes(r.code)).map((r) => r.programmeCode)),
  ].sort();
  const choices: ProgrammeChoice[] = [];
  const unlinked: string[] = [];
  const noSemester: string[] = [];
  for (const dp of dibbaProgrammes) {
    const p = matchProgramme(dp, input);
    const sem = p?.semesters.find((s) => s.year === input.year && s.term === input.term);
    if (!p) unlinked.push(dp);
    else if (!sem) noSemester.push(dp);
    if (!p || !sem) continue;
    if (choices.some((c) => c.semesterId === sem.id)) continue;
    choices.push({
      programmeId: p.id,
      programmeCode: p.code,
      dibbaProgramme: dp,
      semesterId: sem.id,
      semesterName: sem.name,
      offeringId:
        (course &&
          input.offerings.find((o) => o.courseId === course.id && o.semesterId === sem.id)?.id) ??
        null,
    });
  }
  if (choices.length === 0)
    return { kind: 'not-set-up', codes, semesterName, unlinked, noSemester };

  const leadRow = input.rows.find((r) => r.code === lead)!;
  const catalogueTitle = input.rows.find(
    (r) => codes.includes(r.code) && r.catalogueTitle,
  )?.catalogueTitle;
  return {
    kind: 'ready',
    codes,
    title: course?.title ?? displayCourseTitle(leadRow.title, catalogueTitle),
    semesterName,
    course,
    newCourseCodes,
    skippedCodes,
    choices,
    notSetUp: [...unlinked, ...noSemester].sort(),
    mixedNumbers: mixedCourseNumbers(codes),
    slotInfo:
      leadRow.slotNo > 0
        ? `Slot ${leadRow.slotNo}${leadRow.slotDay ? ` · ${DAY[leadRow.slotDay] ?? leadRow.slotDay} ${leadRow.slotSession ?? ''}`.trimEnd() : ''}`
        : null,
  };
}

/** Reads what planOffering needs. */
export async function loadPlanInput(
  codes: string[],
  year: number,
  term: string,
): Promise<PlanInput> {
  const allCodes = [...new Set(codes)];
  const [entries, programmes, courses, anySemester, links] = await Promise.all([
    prisma.dibbaEntry.findMany({
      where: {
        import: { status: 'PUBLISHED', term: { year, term } },
        OR: [{ courseCode: { in: allCodes } }, { course: { bitsCourseNumber: { in: allCodes } } }],
      },
      select: {
        courseCode: true,
        courseTitle: true,
        programmeCode: true,
        slotNo: true,
        slotDay: true,
        slotSession: true,
        course: { select: { bitsCourseNumber: true, title: true } },
      },
    }),
    prisma.programme.findMany({
      select: {
        id: true,
        code: true,
        active: true,
        semesters: {
          where: { year, term },
          select: { id: true, name: true, year: true, term: true },
        },
      },
    }),
    prisma.course.findMany({
      where: {
        OR: [
          { bitsCourseNumber: { in: allCodes } },
          { code: { in: allCodes } },
          { alternateCodes: { hasSome: allCodes } },
        ],
      },
      select: { id: true, bitsCourseNumber: true, code: true, alternateCodes: true, title: true },
    }),
    prisma.semester.findFirst({
      where: { year, term },
      select: { name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.dibbaProgrammeCode.findMany({ select: { code: true, programmeId: true } }),
  ]);
  const offerings = courses.length
    ? await prisma.courseOffering.findMany({
        where: { courseId: { in: courses.map((c) => c.id) }, semester: { year, term } },
        select: { id: true, courseId: true, semesterId: true },
      })
    : [];
  return {
    codes: allCodes,
    year,
    term,
    rows: entries.map((e) => ({
      code: e.course?.bitsCourseNumber ?? e.courseCode,
      title: e.courseTitle,
      programmeCode: e.programmeCode,
      slotNo: e.slotNo,
      slotDay: e.slotDay,
      slotSession: e.slotSession,
      catalogueTitle: e.course?.title ?? null,
    })),
    programmes,
    links: Object.fromEntries(links.map((l) => [l.code, l.programmeId])),
    courses,
    offerings,
    semesterName: anySemester?.name ?? termLabel(`${year}-${term}`),
  };
}

export type SetUpResult =
  | { ok: true; offeringId: string; createdCourse: boolean; createdOffering: boolean }
  | { ok: false; error: string };

/**
 * Adds the course (if no code of the class is catalogued) and its offering in the chosen
 * programme's semester, in one transaction, audit-logged. Re-plans from the database, so the
 * browser can only pick among the choices the plan allows.
 */
export async function setUpOfferingFromDibba(
  actorId: string,
  input: { codes: string[]; year: number; term: string; semesterId: string },
): Promise<SetUpResult> {
  const plan = planOffering(await loadPlanInput(input.codes, input.year, input.term));
  if (plan.kind !== 'ready') return { ok: false, error: planMessage(plan) };
  const choice = plan.choices.find((c) => c.semesterId === input.semesterId);
  if (!choice) return { ok: false, error: 'Pick one of the programmes listed.' };
  if (choice.offeringId)
    return {
      ok: true,
      offeringId: choice.offeringId,
      createdCourse: false,
      createdOffering: false,
    };

  try {
    return await prisma.$transaction(async (tx) => {
      let courseId = plan.course?.id ?? null;
      let createdCourse = false;
      if (!courseId) {
        const [lead, ...alternates] = plan.newCourseCodes;
        const course = await tx.course.create({
          data: {
            bitsCourseNumber: lead!,
            code: lead!,
            alternateCodes: alternates,
            title: plan.title,
          },
        });
        courseId = course.id;
        createdCourse = true;
        await tx.auditLog.create({
          data: {
            actorId,
            action: 'course.create_from_dibba',
            entity: 'Course',
            entityId: course.id,
            after: {
              bitsCourseNumber: lead,
              alternateCodes: alternates,
              title: plan.title,
            } as Prisma.InputJsonValue,
          },
        });
      }
      const existing = await tx.courseOffering.findUnique({
        where: { courseId_semesterId: { courseId, semesterId: choice.semesterId } },
        select: { id: true },
      });
      if (existing)
        return {
          ok: true as const,
          offeringId: existing.id,
          createdCourse,
          createdOffering: false,
        };
      const offering = await tx.courseOffering.create({
        data: { courseId, semesterId: choice.semesterId, slotInfo: plan.slotInfo },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'offering.create_from_dibba',
          entity: 'CourseOffering',
          entityId: offering.id,
          after: {
            codes: plan.codes,
            programme: choice.programmeCode,
            dibbaProgramme: choice.dibbaProgramme,
            semester: choice.semesterName,
            slotInfo: plan.slotInfo,
          } as Prisma.InputJsonValue,
        },
      });
      return { ok: true as const, offeringId: offering.id, createdCourse, createdOffering: true };
    });
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002')
      return {
        ok: false,
        error: 'Someone added this course at the same time. Reload the page and try again.',
      };
    throw err;
  }
}

/** The plain-words reason a plan can't go ahead. */
export function planMessage(plan: Exclude<OfferingPlan, { kind: 'ready' }>): string {
  const codes = plan.codes.join(' / ');
  switch (plan.kind) {
    case 'not-in-dibba':
      return `${codes} isn't in the published Course Dibba for ${plan.semesterName}.`;
    case 'invalid-code':
      return `${plan.code} isn't a standard course number (projects and dissertations aren't), so it can't be added to the course catalogue automatically — ask Admin to add it.`;
    case 'not-set-up':
      return [
        plan.unlinked.length === 1
          ? `Programme code ${plan.unlinked[0]} isn't linked to an HMP programme yet — ask Admin (Admin → Dibba programme codes).`
          : plan.unlinked.length > 1
            ? `Programme codes ${plan.unlinked.join(', ')} aren't linked to an HMP programme yet — ask Admin (Admin → Dibba programme codes).`
            : '',
        plan.noSemester.length
          ? `${plan.semesterName} isn't set up for programme ${plan.noSemester.join(', ')} yet — ask Admin to add it.`
          : '',
      ]
        .filter(Boolean)
        .join(' ');
  }
}

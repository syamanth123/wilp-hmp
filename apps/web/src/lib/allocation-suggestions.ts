import { prisma, HandoutStatus, RoleName, normalizeDibbaCourseCode } from '@hmp/db';
import { awayByUser, awayText } from './away';

/**
 * v1.4.2 — suggestions on the HOG's Allocate (docs/plans/v1.4.2-workload.md §6, F1 and F2). The HOG still
 * picks; a suggestion only fills the pickers.
 */

export interface SuggestedPerson {
  id: string;
  name: string;
  active: boolean;
  away: string | null;
}

export interface DibbaSuggestion {
  termName: string;
  instructors: (SuggestedPerson & { lead: boolean })[];
}

/** F1: the Course Dibba instructor(s) of this course in this request's term, lead first. */
export async function dibbaInstructorSuggestion(
  requestId: string,
): Promise<DibbaSuggestion | null> {
  const r = await prisma.handoutRequest.findUnique({
    where: { id: requestId },
    select: {
      offering: {
        select: {
          course: { select: { bitsCourseNumber: true, alternateCodes: true } },
          semester: { select: { year: true, term: true } },
        },
      },
    },
  });
  if (!r) return null;
  const term = await prisma.academicTerm.findFirst({
    where: { year: r.offering.semester.year, term: r.offering.semester.term },
    select: { id: true, name: true },
  });
  if (!term) return null;
  const codes = [r.offering.course.bitsCourseNumber, ...r.offering.course.alternateCodes].map((c) =>
    normalizeDibbaCourseCode(c),
  );
  const rows = await prisma.courseInstructor.findMany({
    where: { termId: term.id, courseCode: { in: codes } },
    select: { isLead: true, user: { select: { id: true, name: true, active: true } } },
    orderBy: [{ isLead: 'desc' }],
  });
  if (rows.length === 0) return null;
  const away = await awayByUser(rows.map((x) => x.user.id));
  const seen = new Set<string>();
  return {
    termName: term.name,
    instructors: rows
      .filter((x) => !seen.has(x.user.id) && seen.add(x.user.id))
      .map((x) => ({
        id: x.user.id,
        name: x.user.name,
        active: x.user.active,
        lead: x.isLead,
        away: awayText(away.get(x.user.id)),
      })),
  };
}

export interface LastTeam {
  requestId: string;
  refNo: string;
  semesterName: string;
  faculty: SuggestedPerson[];
  sme: SuggestedPerson | null;
  pc: SuggestedPerson | null;
}

const DONE: HandoutStatus[] = [
  HandoutStatus.APPROVED,
  HandoutStatus.PUBLISHED,
  HandoutStatus.ARCHIVED,
];

/**
 * F2: the team of the most recent earlier request for the same course (any of its codes), preferring
 * one that was approved or published, in the same department when known.
 */
export async function lastSemesterTeam(requestId: string): Promise<LastTeam | null> {
  const r = await prisma.handoutRequest.findUnique({
    where: { id: requestId },
    select: {
      createdAt: true,
      offering: {
        select: {
          course: { select: { id: true, bitsCourseNumber: true, alternateCodes: true } },
          semester: { select: { startDate: true, programme: { select: { departmentId: true } } } },
        },
      },
    },
  });
  if (!r) return null;
  const codes = [r.offering.course.bitsCourseNumber, ...r.offering.course.alternateCodes];
  const deptId = r.offering.semester.programme.departmentId;
  const candidates = await prisma.handoutRequest.findMany({
    where: {
      id: { not: requestId },
      status: { notIn: [HandoutStatus.REJECTED, HandoutStatus.DRAFT, HandoutStatus.REQUESTED] },
      offering: {
        course: {
          OR: [
            { id: r.offering.course.id },
            { bitsCourseNumber: { in: codes } },
            { alternateCodes: { hasSome: codes } },
          ],
        },
        semester: { startDate: { lt: r.offering.semester.startDate } },
      },
    },
    select: {
      id: true,
      refNo: true,
      status: true,
      offering: {
        select: {
          semester: {
            select: { name: true, startDate: true, programme: { select: { departmentId: true } } },
          },
        },
      },
      assignments: {
        where: { active: true },
        select: { faculty: { select: { id: true, name: true, active: true } } },
      },
      smeAssignment: { select: { smeUser: { select: { id: true, name: true, active: true } } } },
      assignees: {
        where: { role: RoleName.PROGRAMME_COMMITTEE },
        orderBy: { assignedAt: 'desc' },
        take: 1,
        select: { user: { select: { id: true, name: true, active: true } } },
      },
    },
    orderBy: { offering: { semester: { startDate: 'desc' } } },
    take: 20,
  });
  if (candidates.length === 0) return null;
  const score = (c: (typeof candidates)[number]) =>
    (DONE.includes(c.status) ? 2 : 0) +
    (deptId && c.offering.semester.programme.departmentId === deptId ? 1 : 0);
  // Latest semester first; within it, approved / published and same department first.
  const latestStart = candidates[0]!.offering.semester.startDate.getTime();
  const best = candidates
    .filter((c) => c.offering.semester.startDate.getTime() === latestStart)
    .sort((a, b) => score(b) - score(a))[0]!;
  const people = [
    ...best.assignments.map((a) => a.faculty),
    ...(best.smeAssignment ? [best.smeAssignment.smeUser] : []),
    ...(best.assignees[0] ? [best.assignees[0].user] : []),
  ];
  const away = await awayByUser(people.map((p) => p.id));
  const person = (u: { id: string; name: string; active: boolean }): SuggestedPerson => ({
    ...u,
    away: awayText(away.get(u.id)),
  });
  return {
    requestId: best.id,
    refNo: best.refNo,
    semesterName: best.offering.semester.name,
    faculty: best.assignments.map((a) => person(a.faculty)),
    sme: best.smeAssignment ? person(best.smeAssignment.smeUser) : null,
    pc: best.assignees[0] ? person(best.assignees[0].user) : null,
  };
}

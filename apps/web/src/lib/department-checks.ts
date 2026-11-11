import { prisma, RoleName } from '@hmp/db';
import { loadDibbaCodeRows } from './dibba-programme-codes';
import { departmentOfDibbaCode, loadDepartmentLinks, suggestDepartments } from './departments';
import { DEPARTMENT_ROLES } from './people-save';

/**
 * Data-quality warnings for departments (v1.4.0, plan F14): what still has to be filled in before
 * department-based assignment (v1.4.1) can work. Shown on the Admin overview.
 */
export interface DepartmentChecks {
  departmentsWithoutHog: { id: string; name: string }[];
  programmesWithoutDepartment: number;
  dibbaCodesWithoutDepartment: number;
  dibbaCodes: number;
  peopleWithoutDepartment: number;
  peopleWithSuggestion: number;
  /** Active accounts whose email isn't one address (BITS sign-in can't match them). */
  badEmails: number;
  /** v1.4.1 (H9): active HOG / PC people with no department — they see all departments meanwhile. */
  hogPcWithoutDepartment: number;
  /** v1.4.1 (H10): open requests whose programme has no department — visible to all HOGs / PCs. */
  requestsWithoutDepartment: number;
  /** v1.4.2 (F14): courses behind the Dibba codes with no department. */
  coursesWithoutDepartment: number;
  /** v1.4.2 (F14): Dibba codes (with courses) not linked to an HMP programme — the kick-off can't start them. */
  dibbaCodesNotLinked: number;
  coursesNotLinked: number;
  /** v1.4.2 (F14): HOG / PC / SME / IC people away today with nobody looking after their work. */
  awayWithoutBackup: { id: string; name: string }[];
}

export async function loadDepartmentChecks(): Promise<DepartmentChecks> {
  const [departments, hogs, programmes, dibbaRows, links, noDept] = await Promise.all([
    prisma.department.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.user.findMany({
      where: {
        active: true,
        departmentId: { not: null },
        roles: { some: { role: { name: RoleName.HOG } } },
      },
      select: { departmentId: true },
    }),
    prisma.programme.count({ where: { active: true, departmentId: null } }),
    loadDibbaCodeRows(),
    loadDepartmentLinks(),
    prisma.user.findMany({
      where: {
        active: true,
        departmentId: null,
        roles: { some: { role: { name: { in: DEPARTMENT_ROLES } } } },
      },
      select: { id: true },
    }),
  ]);
  const badEmails = await prisma.user.count({
    where: {
      active: true,
      OR: [
        { email: { contains: ',' } },
        { email: { contains: ' ' } },
        { email: { contains: ';' } },
      ],
    },
  });
  const [hogPcWithoutDepartment, requestsWithoutDepartment] = await Promise.all([
    prisma.user.count({
      where: {
        active: true,
        departmentId: null,
        roles: { some: { role: { name: { in: [RoleName.HOG, RoleName.PROGRAMME_COMMITTEE] } } } },
      },
    }),
    prisma.handoutRequest.count({
      where: {
        status: { notIn: ['PUBLISHED', 'ARCHIVED', 'REJECTED'] },
        offering: { semester: { programme: { departmentId: null } } },
      },
    }),
  ]);
  const withHog = new Set(hogs.map((h) => h.departmentId));
  const noDeptCodes = dibbaRows.filter((r) => !departmentOfDibbaCode(r.code, links));
  const unlinked = dibbaRows.filter((r) => r.courses > 0 && !r.resolved.programme);
  const today = new Date(
    `${new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10)}T00:00:00+05:30`,
  );
  const awayNoBackup = await prisma.userPreference.findMany({
    where: {
      awayUntil: { gte: today },
      OR: [{ awayFrom: null }, { awayFrom: { lte: new Date() } }],
      backupUserId: null,
      user: {
        active: true,
        roles: {
          some: {
            role: {
              name: {
                in: [
                  RoleName.HOG,
                  RoleName.PROGRAMME_COMMITTEE,
                  RoleName.SME,
                  RoleName.INSTRUCTION_CELL,
                ],
              },
            },
          },
        },
      },
    },
    select: { user: { select: { id: true, name: true } } },
  });
  const suggestions = noDept.length ? await suggestDepartments(noDept.map((u) => u.id)) : new Map();
  return {
    departmentsWithoutHog: departments.filter((d) => !withHog.has(d.id)),
    programmesWithoutDepartment: programmes,
    dibbaCodesWithoutDepartment: noDeptCodes.length,
    coursesWithoutDepartment: noDeptCodes.reduce((n, r) => n + r.courses, 0),
    dibbaCodesNotLinked: unlinked.length,
    coursesNotLinked: unlinked.reduce((n, r) => n + r.courses, 0),
    awayWithoutBackup: awayNoBackup.map((a) => a.user),
    dibbaCodes: dibbaRows.length,
    peopleWithoutDepartment: noDept.length,
    peopleWithSuggestion: [...suggestions.values()].filter((s) => s.kind === 'one').length,
    badEmails,
    hogPcWithoutDepartment,
    requestsWithoutDepartment,
  };
}

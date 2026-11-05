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
  const withHog = new Set(hogs.map((h) => h.departmentId));
  const suggestions = noDept.length ? await suggestDepartments(noDept.map((u) => u.id)) : new Map();
  return {
    departmentsWithoutHog: departments.filter((d) => !withHog.has(d.id)),
    programmesWithoutDepartment: programmes,
    dibbaCodesWithoutDepartment: dibbaRows.filter((r) => !departmentOfDibbaCode(r.code, links))
      .length,
    dibbaCodes: dibbaRows.length,
    peopleWithoutDepartment: noDept.length,
    peopleWithSuggestion: [...suggestions.values()].filter((s) => s.kind === 'one').length,
    badEmails,
  };
}

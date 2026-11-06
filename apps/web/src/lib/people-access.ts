import { RoleName } from '@hmp/db';
import { getSessionUser, requireRole, type SessionUser } from '@hmp/auth';

export { ADMIN_ACCOUNT_MESSAGE, ADMIN_ROLE_MESSAGE, adminOnlyProblem } from './people-rules';

/**
 * Who may manage People, Upload people and Departments (v1.4.0): the Admin, and the Instruction Cell
 * — who know which department each faculty member belongs to — with limits (lib/people-rules.ts):
 * the IC can't give or remove the Admin role and can't change an Admin account. Departments has no
 * delete for anyone (rename or deactivate only). Everything stays audit-logged.
 */
export const PEOPLE_MANAGER_ROLES: RoleName[] = [RoleName.ADMIN, RoleName.INSTRUCTION_CELL];

/** Where the pages are mounted: Admin's own area, or the Instruction Cell's. */
export type PeopleBase = '/admin' | '/ic';

export type PeopleManager = SessionUser & { isAdmin: boolean };

export async function requirePeopleManager(): Promise<PeopleManager> {
  const user = requireRole(await getSessionUser(), PEOPLE_MANAGER_ROLES);
  return { ...user, isAdmin: user.roles.includes(RoleName.ADMIN) };
}

/** The same lists show under /admin and /ic; refresh both after a change. */
export const PEOPLE_PATHS = [
  '/admin',
  '/ic',
  '/admin/people',
  '/ic/people',
  '/admin/departments',
  '/ic/departments',
];

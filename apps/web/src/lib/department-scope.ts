import { RoleName, type Prisma } from '@hmp/db';

/**
 * v1.4.1 — department scoping for HOG and PC (docs/plans/v1.4.1-assignment.md §C). One rule, used by
 * every HOG / PC list, count, detail page, action, bulk tool and the Library:
 *
 *   a HOG / PC sees the requests of their department
 *     + any request they are personally on (a current RequestAssignee, any role)
 *     + requests whose department isn't known yet (programme not tagged — H10)
 *   a HOG / PC with no department sees everything, with a notice (H9)
 *   IC / Admin: everything; faculty / SME: unchanged (their own work).
 *
 * A request's department = its course offering → semester → programme → department.
 */

export interface DeptScopeUser {
  id: string;
  roles: RoleName[];
  departmentId?: string | null;
}

export const inDepartment = (departmentId: string): Prisma.HandoutRequestWhereInput => ({
  offering: { semester: { programme: { departmentId } } },
});

export const DEPARTMENT_UNKNOWN: Prisma.HandoutRequestWhereInput = {
  offering: { semester: { programme: { departmentId: null } } },
};

export const personallyOn = (userId: string): Prisma.HandoutRequestWhereInput => ({
  assignees: { some: { userId, endedAt: null } },
});

const isOversightAll = (u: Pick<DeptScopeUser, 'roles'>) =>
  u.roles.includes(RoleName.ADMIN) || u.roles.includes(RoleName.INSTRUCTION_CELL);

export const isHogOrPc = (u: Pick<DeptScopeUser, 'roles'>) =>
  u.roles.includes(RoleName.HOG) || u.roles.includes(RoleName.PROGRAMME_COMMITTEE);

/**
 * The HOG / PC part of the rule: null = no limit (IC / Admin, or a HOG / PC with no department yet).
 * Callers AND it with whatever else they filter on.
 */
export function departmentScope(user: DeptScopeUser): Prisma.HandoutRequestWhereInput | null {
  if (isOversightAll(user)) return null;
  if (!user.departmentId) return null;
  return {
    OR: [inDepartment(user.departmentId), DEPARTMENT_UNKNOWN, personallyOn(user.id)],
  };
}

/** H9: a HOG / PC whose department isn't set sees all departments — and is told so. */
export function seesAllForMissingDepartment(user: DeptScopeUser): boolean {
  return !isOversightAll(user) && isHogOrPc(user) && !user.departmentId;
}

/** In-memory check of the same rule, for one request already loaded. */
export function requestInScope(
  user: DeptScopeUser,
  request: { departmentId: string | null; assigneeIds: string[] },
): boolean {
  if (isOversightAll(user) || !user.departmentId) return true;
  return (
    request.departmentId === null ||
    request.departmentId === user.departmentId ||
    request.assigneeIds.includes(user.id)
  );
}

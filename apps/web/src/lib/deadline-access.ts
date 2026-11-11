import { prisma, RoleName } from '@hmp/db';
import type { DeptScopeUser } from './department-scope';
import { requestVisibleTo } from './request-scope';

/**
 * v1.4.2 — who can change a request's due dates: the IC and Admin; a HOG for a request that is theirs (named
 * HOG), or — when no HOG is named yet — one in their department scope.
 */
export async function canChangeDeadlines(user: DeptScopeUser, requestId: string): Promise<boolean> {
  if (user.roles.includes(RoleName.ADMIN) || user.roles.includes(RoleName.INSTRUCTION_CELL))
    return true;
  if (!user.roles.includes(RoleName.HOG)) return false;
  const named = await prisma.requestAssignee.findFirst({
    where: { requestId, role: RoleName.HOG, endedAt: null },
    select: { userId: true },
  });
  if (named) return named.userId === user.id;
  return requestVisibleTo(user, requestId);
}

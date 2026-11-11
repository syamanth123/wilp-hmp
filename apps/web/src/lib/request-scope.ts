import { prisma } from '@hmp/db';
import { departmentScope, type DeptScopeUser } from './department-scope';
import { coveringFor } from './backup-access';

/**
 * v1.4.1: is this request inside the user's department scope (lib/department-scope.ts)? HOG / PC
 * detail pages answer "not found" and every HOG / PC action refuses when it isn't — the lists hide
 * such requests, so only a typed or old address reaches here.
 */
export async function requestVisibleTo(
  user: DeptScopeUser | null,
  requestId: string | null | undefined,
): Promise<boolean> {
  if (!user || !requestId) return false;
  const scope = departmentScope(user);
  if (!scope) return true;
  const n = await prisma.handoutRequest.count({ where: { AND: [{ id: requestId }, scope] } });
  if (n > 0) return true;
  // v1.4.2 (H18): the back-up of an away colleague reaches that colleague's requests too.
  return (await coveringFor(user, requestId)) !== null;
}

export const OUT_OF_SCOPE_MESSAGE = 'That request belongs to another department.';

/** Same shape as @hmp/auth's AuthorizationError (status 403), without importing the auth package here. */
export class OutOfScopeError extends Error {
  status = 403 as const;
  constructor() {
    super(OUT_OF_SCOPE_MESSAGE);
    this.name = 'AuthorizationError';
  }
}

/** For server actions: throws when the request is outside the user's department. */
export async function assertRequestInScope(
  user: DeptScopeUser,
  requestId: FormDataEntryValue | string | null | undefined,
): Promise<void> {
  const id = typeof requestId === 'string' ? requestId : null;
  if (!(await requestVisibleTo(user, id))) throw new OutOfScopeError();
}

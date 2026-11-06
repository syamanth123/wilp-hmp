import { prisma, type RoleName } from '@hmp/db';
import { auth } from './config';
import { loadUserAccess, type SessionUser } from './rbac';

/**
 * v1.4: roles are read from the database, not frozen at sign-in. The sign-in token keeps the roles
 * it was issued with (it runs on the Edge, where the database can't be reached); this server-side
 * check compares the person's `accessVersion` (bumped on every role / department / active change)
 * and re-reads their roles when it moved — so an Admin's change shows on the person's next page, and
 * a deactivated person is signed out. One small query per person, cached for a few seconds.
 */
const FRESH_MS = 5_000;
const cache = new Map<
  string,
  {
    at: number;
    active: boolean;
    version: number;
    departmentId: string | null;
    access: Pick<SessionUser, 'roles' | 'permissions'> | null;
  }
>();

async function currentAccess(
  userId: string,
  tokenAccess: Pick<SessionUser, 'roles' | 'permissions'>,
) {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < FRESH_MS) return hit;
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { active: true, accessVersion: true, departmentId: true },
  });
  if (!row) return { at: Date.now(), active: false, version: -1, departmentId: null, access: null };
  // Version 0 = never changed since v1.4: the token's roles are still right.
  const access =
    hit && hit.version === row.accessVersion
      ? hit.access
      : row.accessVersion === 0
        ? tokenAccess
        : await loadUserAccess(userId);
  const entry = {
    at: Date.now(),
    active: row.active,
    version: row.accessVersion,
    departmentId: row.departmentId,
    access,
  };
  cache.set(userId, entry);
  return entry;
}

/**
 * Server-side helper. Returns the current SessionUser or null (signed out, or deactivated since).
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  const tokenAccess = {
    roles: (session.user.roles ?? []) as RoleName[],
    permissions: (session.user.permissions ?? []) as string[],
  };
  const now = await currentAccess(session.user.id, tokenAccess);
  if (!now.active || !now.access) return null;
  return {
    id: session.user.id,
    email: session.user.email ?? '',
    name: session.user.name ?? '',
    roles: now.access.roles,
    permissions: now.access.permissions,
    departmentId: now.departmentId,
  };
}

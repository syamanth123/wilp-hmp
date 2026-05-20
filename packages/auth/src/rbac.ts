import { RoleName, prisma } from '@hmp/db';

export class AuthorizationError extends Error {
  status = 403 as const;
  constructor(message = 'Forbidden') {
    super(message);
    this.name = 'AuthorizationError';
  }
}

export class AuthenticationError extends Error {
  status = 401 as const;
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  roles: RoleName[];
  permissions: string[];
}

export function hasRole(user: SessionUser | null | undefined, role: RoleName | RoleName[]): boolean {
  if (!user) return false;
  // ADMIN is a super-role: it bypasses every role-gate. This matches AppShell
  // navigation which already lists every area (Admin/IC/HOG/PC/Faculty) for admins.
  if (user.roles.includes(RoleName.ADMIN)) return true;
  const needed = Array.isArray(role) ? role : [role];
  return needed.some((r) => user.roles.includes(r));
}

export function hasPermission(user: SessionUser | null | undefined, permission: string): boolean {
  if (!user) return false;
  // ADMIN is a super-role: it bypasses every permission gate, matching the
  // hasRole() behaviour above. Without this, an ADMIN whose role->permission
  // grants don't explicitly include a given key (a real possibility — the
  // seed grants are not 100% exhaustive) would be denied — surprising for a
  // super-role. Tested in rbac.test.ts.
  if (user.roles.includes(RoleName.ADMIN)) return true;
  return user.permissions.includes(permission);
}

export function requireRole(user: SessionUser | null | undefined, role: RoleName | RoleName[]): SessionUser {
  if (!user) throw new AuthenticationError();
  if (!hasRole(user, role)) throw new AuthorizationError();
  return user;
}

export function requirePermission(user: SessionUser | null | undefined, permission: string): SessionUser {
  if (!user) throw new AuthenticationError();
  if (!hasPermission(user, permission)) throw new AuthorizationError(`Missing permission: ${permission}`);
  return user;
}

/**
 * Loads a user's effective roles + permissions from the DB.
 * Cached at session-build time; do not call on every request.
 */
export async function loadUserAccess(userId: string): Promise<Pick<SessionUser, 'roles' | 'permissions'>> {
  const memberships = await prisma.userRole.findMany({
    where: { userId },
    include: {
      role: {
        include: {
          permissions: { include: { permission: true } },
        },
      },
    },
  });
  const roles = memberships.map((m) => m.role.name);
  const permissions = new Set<string>();
  for (const m of memberships) {
    for (const rp of m.role.permissions) permissions.add(rp.permission.key);
  }
  return { roles, permissions: [...permissions] };
}

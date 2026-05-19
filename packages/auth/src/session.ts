import { auth } from './config';
import type { SessionUser } from './rbac';
import type { RoleName } from '@hmp/db';

/**
 * Server-side helper. Returns the current SessionUser or null.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return {
    id: session.user.id,
    email: session.user.email ?? '',
    name: session.user.name ?? '',
    roles: (session.user.roles ?? []) as RoleName[],
    permissions: (session.user.permissions ?? []) as string[],
  };
}

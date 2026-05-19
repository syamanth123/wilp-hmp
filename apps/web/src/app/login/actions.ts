'use server';

import { signIn } from '@hmp/auth';
import { prisma, type RoleName } from '@hmp/db';
import { defaultRouteForUser } from '@/lib/routing';

export async function signInAction(input: { email: string; password: string; next?: string }) {
  try {
    await signIn('credentials', {
      email: input.email,
      password: input.password,
      redirect: false,
    });
  } catch {
    return { error: 'Invalid email or password.' };
  }

  // signIn() did not throw — credentials are valid. We look up roles directly
  // because the NextAuth cookie just set by signIn() is not yet visible to
  // auth() / getSessionUser() within the same server-action call (NextAuth v5
  // beta + server-actions cookie-propagation gotcha). The cookie IS sent to
  // the browser and works on subsequent requests — we only need the role list
  // here to pick the redirect target.
  const memberships = await prisma.userRole.findMany({
    where: { user: { email: input.email, active: true } },
    select: { role: { select: { name: true } } },
  });
  const roles = memberships.map((m) => m.role.name) as RoleName[];
  if (roles.length === 0) return { error: 'Invalid email or password.' };

  const redirectTo =
    input.next && input.next !== '/login'
      ? input.next
      : defaultRouteForUser({
          id: '',
          email: input.email,
          name: '',
          roles,
          permissions: [],
        });

  return { redirectTo };
}

export async function signOutAction() {
  const { signOut } = await import('@hmp/auth');
  await signOut({ redirect: false });
}

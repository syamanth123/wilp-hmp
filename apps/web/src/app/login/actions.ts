'use server';

import { headers } from 'next/headers';
import { signIn } from '@hmp/auth';
import { prisma, type RoleName } from '@hmp/db';
import { defaultRouteForUser } from '@/lib/routing';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';

export async function signInAction(input: { email: string; password: string; next?: string }) {
  // Login throttle (Prompt 20). The form posts here via a SERVER ACTION — the
  // browser never hits /api/auth/callback/credentials directly — so this, not
  // the auth-route wrapper, is the real login path. Shares the `login:${ip}`
  // counter with that wrapper (which stays as defense-in-depth for direct API
  // POSTs). Keyed by IP from the proxy's x-forwarded-for. Fail-open if Redis is
  // down; RPC-shaped { error } since this is a server action.
  const ip = (headers().get('x-forwarded-for')?.split(',')[0] ?? 'unknown').trim() || 'unknown';
  const rl = await rateLimit(`login:${ip}`, RATE_LIMITS.login.limit, RATE_LIMITS.login.windowSec);
  if (!rl.ok) {
    return { error: 'Too many login attempts. Please wait a few minutes and try again.' };
  }

  try {
    await signIn('credentials', {
      email: input.email,
      password: input.password,
      redirect: false,
    });
  } catch {
    return { error: 'Invalid email or password.' };
  }

  // We deliberately do NOT call getSessionUser() / auth() here. In NextAuth v5,
  // signIn() sets the session cookie via Set-Cookie on the *response*, but
  // anything reading cookies inside the same server-action call reads from
  // the *request* cookies (via next/headers `cookies()`), which still reflect
  // the pre-signIn state. The cookie becomes visible on the next request.
  //
  // Instead we look up the user's roles directly from Prisma — the
  // email/password was just verified by signIn() not throwing, so we know the
  // user exists and is active.
  //
  // Why not the "canonical" v5 patterns? Two reasons:
  //   - `await signIn(...); redirect('/')` — works because redirect() throws
  //     before any cookie read, but forces a full page nav and can't pick a
  //     role-specific destination (admin → /admin vs faculty → /faculty).
  //   - `signIn('credentials', { ..., redirect: true })` — same: NextAuth
  //     redirects server-side before we can branch on role.
  // Both "work" only by *never* reading the session in the same action.
  // They sidestep the gotcha rather than fix it. Our flow needs role info to
  // pick the destination, so we read the source of truth (DB) directly and
  // let the existing client-side router.push() in login-form.tsx perform a
  // soft navigation. The cookie is set correctly and works everywhere on the
  // next request.
  //
  // Future maintainer: do NOT "clean this up" by replacing the Prisma lookup
  // with getSessionUser() — that's the bug this comment exists to prevent.
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

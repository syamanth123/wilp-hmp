'use server';

import { cookies, headers } from 'next/headers';
import { signIn } from '@hmp/auth';
import { prisma, type RoleName } from '@hmp/db';
import { defaultRouteForUser } from '@/lib/routing';
import { clientIpFromHeaders } from '@/lib/client-ip';
import { loginRateLimit, clearLoginUsername, recordLoginFailure } from '@/lib/rate-limit';

const INVALID_CREDENTIALS = 'Invalid email or password.';

/**
 * Fingerprint of the Auth.js session cookie(s) in this request's cookie store
 * (`authjs.session-token`, its `__Secure-` form, or chunked `.N` names). The
 * store starts as the request's own cookies and signIn() writes into it, so a
 * change between before and after means Auth.js issued a fresh session — the
 * one thing a rejected attempt can never produce.
 */
function sessionCookieFingerprint(): string {
  return cookies()
    .getAll()
    .filter((c) => /session-token(\.\d+)?$/.test(c.name) && c.value !== '')
    .map((c) => `${c.name}=${c.value}`)
    .sort()
    .join(';');
}

/**
 * Auth.js signals a rejected password by throwing CredentialsSignin. Matched
 * on `type` (set by AuthError's constructor) rather than instanceof, so it
 * holds across package copies. Anything else thrown by signIn() is an
 * infrastructure failure: reported to the user the same way, but not counted
 * against the per-IP budget.
 */
function isCredentialsRejection(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { type?: unknown }).type === 'CredentialsSignin'
  );
}

export async function signInAction(input: { email: string; password: string; next?: string }) {
  // Login throttle (Prompt 20 + Prompt 6 hardening). The form posts here via a
  // SERVER ACTION — the browser never hits /api/auth/callback/credentials
  // directly — so this, not the auth-route wrapper, is the real login path.
  // TWO limits: per-IP (counts REJECTED attempts only, so successful logins
  // from a shared campus NAT can never lock the campus out) + tight
  // per-username (every attempt; brute-force / enumeration), sharing the
  // `login:ip:*` / `login:user:*` counters with that wrapper (defense-in-depth
  // for direct API POSTs). The IP is X-Real-IP (nginx: $remote_addr) or the
  // LAST X-Forwarded-For hop — never the visitor-controlled first hop (see
  // client-ip.ts). Fail-open if Redis is down; RPC-shaped { error } since this
  // is a server action.
  const ip = clientIpFromHeaders(headers());
  const rl = await loginRateLimit(ip, input.email);
  if (!rl.ok) {
    return { error: 'Too many login attempts. Please wait a few minutes and try again.' };
  }

  const sessionBefore = sessionCookieFingerprint();
  try {
    await signIn('credentials', {
      email: input.email,
      password: input.password,
      redirect: false,
    });
  } catch (err) {
    // Rejected credentials. This catch and the no-cookie check below are the
    // ONLY places the per-IP counter advances; a successful login never
    // spends it.
    if (isCredentialsRejection(err)) await recordLoginFailure(ip);
    return { error: INVALID_CREDENTIALS };
  }

  // signIn() resolving is NOT proof of acceptance. Auth.js answers a rejected
  // attempt with `{ url: '/login?error=CredentialsSignin' }` instead of
  // throwing whenever the request carries an `X-Auth-Return-Redirect` header,
  // and next-auth copies that header from OUR incoming request, so any client
  // can send it. The one signal a rejected attempt can never produce is a
  // freshly issued session cookie, so require that before treating this as a
  // login (otherwise a probe would clear the per-username counter and read
  // back the account's role below).
  if (sessionCookieFingerprint() === sessionBefore) {
    await recordLoginFailure(ip);
    return { error: INVALID_CREDENTIALS };
  }

  // Valid credentials — clear the per-username counter so a legitimate user who
  // was briefly throttled isn't left blocked. Per-IP counter is left intact.
  await clearLoginUsername(input.email);

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
  if (roles.length === 0) return { error: INVALID_CREDENTIALS };

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

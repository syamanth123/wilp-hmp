import type { NextRequest } from 'next/server';
import { handlers } from '@hmp/auth';
import { clientIpFromHeaders } from '@/lib/client-ip';
import {
  loginIpRateLimit,
  loginRateLimit,
  recordLoginFailure,
  tooManyRequests,
} from '@/lib/rate-limit';

// Login rate limiting (Prompt 20), Node runtime (NOT middleware — Edge can't
// use ioredis; NOT @hmp/auth's authorize() — importing ioredis there would drag
// it toward the Edge middleware bundle).
//
// NOTE: the PRIMARY login path is the `signInAction` server action (the login
// form calls it; the browser never POSTs here directly), and THAT is where the
// main throttle lives. This wrapper is DEFENSE-IN-DEPTH for a direct POST to
// /api/auth/callback/credentials (bypassing the form). Both share the
// `login:ip:*` (rejected attempts only) and `login:user:*` (every attempt)
// counters, so the limits are unified across both paths.
export const { GET } = handlers;
const authPost = handlers.POST;

/**
 * The email of a credentials POST, read the way Auth.js reads the body
 * (@auth/core lib/utils/web.js getBody: JSON or form-urlencoded; any other
 * content type carries no credentials, so authorize() rejects it anyway).
 * Parsed from a CLONE so the original body stays readable by NextAuth.
 */
async function emailFromBody(req: NextRequest): Promise<string> {
  const contentType = req.headers.get('content-type') ?? '';
  try {
    if (contentType.includes('application/json')) {
      const body: unknown = await req.clone().json();
      const email = (body as { email?: unknown } | null)?.email;
      return typeof email === 'string' ? email : '';
    }
    if (contentType.includes('application/x-www-form-urlencoded')) {
      return String((await req.clone().formData()).get('email') ?? '');
    }
  } catch {
    /* unparseable body — Auth.js rejects it too; per-IP limit only */
  }
  return '';
}

/**
 * Auth.js issues the session cookie only when authorize() accepted the
 * credentials; a rejected attempt answers with a redirect to
 * `/login?error=CredentialsSignin` (or `{ url }` for a fetch client) and no
 * session cookie. Name-agnostic so the `__Secure-` prefix and cookie chunking
 * (`…session-token.0`) both match; an expiring cookie (`=; Max-Age=0`) does not.
 */
function setsSessionCookie(res: Response): boolean {
  return res.headers.getSetCookie().some((c) => /session-token(\.\d+)?=[^;]+/i.test(c));
}

export async function POST(req: NextRequest): Promise<Response> {
  // Only throttle credentials-callback (actual login attempts).
  // Other auth POSTs (session refresh, future OAuth/SAML callbacks) bypass it.
  // When SAML SSO lands in Prompt 19, verify this doesn't throttle SAML callbacks.
  if (!req.nextUrl.pathname.endsWith('/callback/credentials')) return authPost(req);

  const ip = clientIpFromHeaders(req.headers);
  // When the email is present, apply BOTH limits (same counters as the form
  // path); otherwise fall back to per-IP only.
  const email = await emailFromBody(req);
  const rl = email ? await loginRateLimit(ip, email) : await loginIpRateLimit(ip);
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  const res = await authPost(req);
  // The per-IP counter advances only on a REJECTED attempt (see rate-limit.ts).
  if (!setsSessionCookie(res)) await recordLoginFailure(ip);
  return res;
}

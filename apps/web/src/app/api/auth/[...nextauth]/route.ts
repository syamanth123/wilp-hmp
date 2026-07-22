import type { NextRequest } from 'next/server';
import { handlers } from '@hmp/auth';
import { rateLimit, tooManyRequests, RATE_LIMITS, loginRateLimit } from '@/lib/rate-limit';

// Login rate limiting (Prompt 20), Node runtime (NOT middleware — Edge can't
// use ioredis; NOT @hmp/auth's authorize() — importing ioredis there would drag
// it toward the Edge middleware bundle).
//
// NOTE: the PRIMARY login path is the `signInAction` server action (the login
// form calls it; the browser never POSTs here directly), and THAT is where the
// main throttle lives. This wrapper is DEFENSE-IN-DEPTH for a direct POST to
// /api/auth/callback/credentials (bypassing the form). Both share the
// `login:${ip}` counter, so the 5/15min limit is unified across both paths.
export const { GET } = handlers;
const authPost = handlers.POST;

export async function POST(req: NextRequest): Promise<Response> {
  // Only throttle credentials-callback (actual login attempts).
  // Other auth POSTs (session refresh, future OAuth/SAML callbacks) bypass it.
  // When SAML SSO lands in Prompt 19, verify this doesn't throttle SAML callbacks.
  if (req.nextUrl.pathname.endsWith('/callback/credentials')) {
    const ip = (req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown').trim() || 'unknown';
    // Parse a CLONE so the original body stays readable by the NextAuth handler.
    // When the email is present, apply BOTH limits (same counters as the form
    // path); otherwise fall back to per-IP only.
    let email = '';
    try {
      email = String((await req.clone().formData()).get('email') ?? '');
    } catch {
      /* not form-encoded — per-IP only */
    }
    const rl = email
      ? await loginRateLimit(ip, email)
      : await rateLimit(`login:ip:${ip}`, RATE_LIMITS.loginIp.limit, RATE_LIMITS.loginIp.windowSec);
    if (!rl.ok) return tooManyRequests(rl.retryAfterSec);
  }
  return authPost(req);
}

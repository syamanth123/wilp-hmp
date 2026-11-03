import { NextResponse, type NextRequest } from 'next/server';
import { getSamlSetup } from '@/lib/saml/config';
import { createSaml } from '@/lib/saml/sp';
import { safeNextPath } from '@/lib/saml/relay';
import { appUrl } from '@/lib/saml/app-url';
import { clientIpFromHeaders } from '@/lib/client-ip';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/saml/login?next=/path — "Sign in with BITS ID". Sends the browser to the BITS IdP with
 * a signed AuthnRequest (HTTP-Redirect, RSA-SHA256). `next` rides along as RelayState and is
 * re-checked when the user comes back. Each request ID is remembered for 5 minutes, so the
 * per-IP limit is generous (a whole campus can sit behind one address) but bounded.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const setup = getSamlSetup();
  if (setup.status !== 'ok') return NextResponse.redirect(appUrl('/login?sso=unavailable'), 303);

  const rl = await rateLimit(`saml:login:${clientIpFromHeaders(req.headers)}`, 300, 5 * 60);
  if (!rl.ok) return NextResponse.redirect(appUrl('/login?sso=busy'), 303);

  const relay = safeNextPath(req.nextUrl.searchParams.get('next')) ?? '';
  try {
    const url = await createSaml(setup.settings).getAuthorizeUrlAsync(relay, {});
    return NextResponse.redirect(url, 302);
  } catch (e) {
    console.error('[saml] could not build the sign-in request', (e as Error).message);
    return NextResponse.redirect(appUrl('/login?sso=unavailable'), 303);
  }
}

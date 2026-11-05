import { NextResponse } from 'next/server';
import { signOut } from '@hmp/auth';
import { appUrl } from '@/lib/saml/app-url';

export const dynamic = 'force-dynamic';

/**
 * v1.4.0: someone switched off (Admin → People) while signed in. Their sign-in cookie is still valid,
 * so the pages can't simply send them to /login — the middleware would send a signed-in visitor
 * straight back (a redirect loop). This route (under /api, so outside the middleware) clears the
 * cookie first; the login page then says the account is switched off.
 */
export async function GET() {
  await signOut({ redirect: false });
  return NextResponse.redirect(appUrl('/login?sso=inactive'), 303);
}

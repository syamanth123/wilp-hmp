import { NextResponse } from 'next/server';
import { auth } from '@hmp/auth';

// Content-Security-Policy (Prompt 20). Built per request with a fresh nonce.
// - script-src: nonce + strict-dynamic — NO unsafe-inline/unsafe-eval. Next 14
//   propagates this nonce to its own inline hydration scripts (it reads the CSP
//   from the forwarded request header below). The app is fully dynamic (behind
//   auth), so the loss of static optimization that nonces force costs nothing.
// - style-src: unsafe-inline is unavoidable + low-risk — hand-written <style>
//   blocks (login) + ProseMirror/Next runtime inline styles. Style injection is
//   a far weaker vector than script injection.
// - Only external origins are Google Fonts (style + font). AI APIs are
//   server-side; S3 downloads are navigations — neither is browser-loaded.
// NOTE: 'strict-dynamic' has known version-sensitivity with Next 14's nonce'd
// scripts. If a future upgrade blocks Next's scripts despite the nonce, the
// documented fallback is to drop 'strict-dynamic' and rely on 'self' + nonce.
// This MUST run on the Edge runtime — keep Node-only deps (ioredis) out of the
// middleware graph; rate limiting lives at Node-runtime endpoints instead.
function buildCsp(nonce: string): string {
  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
    `font-src 'self' https://fonts.gstatic.com`,
    `img-src 'self' data: blob:`,
    `connect-src 'self'`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
  ].join('; ');
}

export default auth((req) => {
  const { nextUrl } = req;
  const isAuthed = !!req.auth?.user;
  const isLogin = nextUrl.pathname === '/login';

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = buildCsp(nonce);

  // Redirects render nothing, so they only need the response CSP header (no
  // forwarded nonce). The render path forwards x-nonce + the CSP on the request
  // so the layout can read the nonce and Next can noncify its inline scripts.
  let response: NextResponse;
  if (!isAuthed && !isLogin) {
    const url = new URL('/login', nextUrl);
    url.searchParams.set('next', nextUrl.pathname);
    response = NextResponse.redirect(url);
  } else if (isAuthed && isLogin) {
    response = NextResponse.redirect(new URL('/', nextUrl));
  } else {
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set('x-nonce', nonce);
    requestHeaders.set('content-security-policy', csp);
    response = NextResponse.next({ request: { headers: requestHeaders } });
  }
  response.headers.set('content-security-policy', csp);
  return response;
});

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico)$).*)',
  ],
};

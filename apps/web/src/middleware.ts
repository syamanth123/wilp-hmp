import { NextResponse } from 'next/server';
import { auth } from '@hmp/auth';

export default auth((req) => {
  const { nextUrl } = req;
  const isAuthed = !!req.auth?.user;
  const isLogin = nextUrl.pathname === '/login';

  if (!isAuthed && !isLogin) {
    const url = new URL('/login', nextUrl);
    url.searchParams.set('next', nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  if (isAuthed && isLogin) {
    return NextResponse.redirect(new URL('/', nextUrl));
  }
  return NextResponse.next();
});

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico)$).*)'],
};

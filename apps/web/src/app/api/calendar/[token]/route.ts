import { calendarEvents, toIcs, userForCalendarToken } from '@/lib/calendar';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * v1.4.2 (F9, H21) — a person's HMP due dates as a calendar feed: GET /api/calendar/<token>.ics. The token is
 * the private link (stored only as a fingerprint); calendars poll this address. It is never logged by HMP;
 * the release script keeps the web server from logging this path. An unknown, replaced or stopped link
 * answers 404 without saying which.
 */
export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const token = params.token.replace(/\.ics$/i, '');
  const user = await userForCalendarToken(token);
  if (!user) return new Response('Not found', { status: 404 });
  const body = toIcs(await calendarEvents(user), 'HMP deadlines');
  return new Response(body, {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'cache-control': 'private, no-store',
      'referrer-policy': 'no-referrer',
    },
  });
}

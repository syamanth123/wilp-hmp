import { getSessionUser } from '@hmp/auth';
import { calendarEvents, toIcs } from '@/lib/calendar';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** v1.4.2 — "Download .ics": the same dates as a file, for the signed-in person (no link, no updates). */
export async function GET() {
  const me = await getSessionUser();
  if (!me) return new Response('Sign in first.', { status: 401 });
  const body = toIcs(await calendarEvents(me), 'HMP deadlines');
  return new Response(body, {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': 'attachment; filename="hmp-deadlines.ics"',
      'cache-control': 'private, no-store',
    },
  });
}

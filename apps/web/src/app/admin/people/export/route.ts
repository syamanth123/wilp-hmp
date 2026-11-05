import { RoleName } from '@hmp/db';
import { getSessionUser, hasRole } from '@hmp/auth';
import { exportPeopleCsv } from '@/lib/people-import';

export const dynamic = 'force-dynamic';

/** The current people list in the upload format (v1.4). Admin only. */
export async function GET() {
  const me = await getSessionUser();
  if (!me) return new Response('Sign in first.', { status: 401 });
  if (!hasRole(me, RoleName.ADMIN)) return new Response('Not allowed.', { status: 403 });
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(await exportPeopleCsv(), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="hmp-people-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}

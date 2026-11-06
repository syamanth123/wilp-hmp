import { getSessionUser, hasRole } from '@hmp/auth';
import { PEOPLE_MANAGER_ROLES } from '@/lib/people-access';
import { exportPeopleXlsx } from '@/lib/people-import';

export const dynamic = 'force-dynamic';

/** The current people list as Excel, in the upload format, with suggested departments (v1.4.0, H6). Admin and the Instruction Cell. */
export async function GET() {
  const me = await getSessionUser();
  if (!me) return new Response('Sign in first.', { status: 401 });
  if (!hasRole(me, PEOPLE_MANAGER_ROLES)) return new Response('Not allowed.', { status: 403 });
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(new Uint8Array(await exportPeopleXlsx()), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="hmp-people-${stamp}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}

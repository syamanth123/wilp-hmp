import { getSessionUser } from '@hmp/auth';
import { isAllowed } from '@/lib/routing';

/**
 * Serves a bulk-upload CSV template only to the roles that may use the
 * matching bulk page — the same rule the page itself follows (lib/routing.ts),
 * so e.g. a faculty member can't download the HOG template by address.
 */
export async function csvTemplateResponse(
  req: Request,
  csv: string,
  filename: string,
): Promise<Response> {
  const me = await getSessionUser();
  const path = new URL(req.url).pathname;
  if (!me || !isAllowed(me, path)) {
    return new Response('You don’t have access to this template.', {
      status: me ? 403 : 401,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

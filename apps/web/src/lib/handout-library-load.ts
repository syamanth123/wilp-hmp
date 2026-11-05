import { Prisma, prisma } from '@hmp/db';
import type { SessionUser } from '@hmp/auth';
import { attachChangeSizes } from './handout-history';
import { loadLibrary, parseLibraryFilter, type LibraryPage } from './handout-library';

/**
 * The one way a page or route loads the library for a signed-in user from an address — the list
 * page, the Excel export and the tests all go through here, so they can never disagree.
 */
export async function loadLibraryFromAddress(
  user: Pick<SessionUser, 'id' | 'roles'>,
  sp: Record<string, string | undefined>,
  now?: Date,
): Promise<LibraryPage> {
  return loadLibrary(user, parseLibraryFilter(sp, user.roles), {
    now,
    attachChangeSizes,
    corpusAwaiting: () =>
      prisma.handoutImport.count({
        where: { approvedForReuse: false, data: { not: Prisma.DbNull } },
      }),
  });
}

/** Cookie remembering a person's last library address (decision D3: per browser, not the DB). */
export const LAST_VIEW_COOKIE = 'hmp_lib_last';

/** "<userId>|<query>" → the query, only when it belongs to this user. */
export function lastViewFor(cookieValue: string | undefined, userId: string): string | null {
  if (!cookieValue) return null;
  const raw = decodeURIComponent(cookieValue);
  const bar = raw.indexOf('|');
  if (bar < 0 || raw.slice(0, bar) !== userId) return null;
  const q = raw.slice(bar + 1);
  return q.startsWith('?') && q.length > 1 && q.length < 1500 ? q : null;
}

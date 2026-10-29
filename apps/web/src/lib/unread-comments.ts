import { prisma, NotificationChannel } from '@hmp/db';

/**
 * "New" comments for a user = comments whose in-portal notification they
 * have not read yet. Every comment notifies its readers in the portal
 * (lib/notifications.ts, kind "comment.added", meta.commentId), and opening
 * the bell marks them read — so no new table is needed.
 */

/** Pure: the comment ids carried by a list of notification `meta` values. */
export function commentIdsFromMeta(metas: unknown[]): Set<string> {
  const ids = new Set<string>();
  for (const meta of metas) {
    if (meta && typeof meta === 'object') {
      const m = meta as { kind?: unknown; commentId?: unknown };
      if (m.kind === 'comment.added' && typeof m.commentId === 'string') ids.add(m.commentId);
    }
  }
  return ids;
}

/** Ids of comments the user has an unread in-portal notification for. */
export async function loadUnreadCommentIds(userId: string): Promise<Set<string>> {
  const rows = await prisma.notification.findMany({
    where: {
      userId,
      channel: NotificationChannel.IN_PORTAL,
      readAt: null,
      meta: { path: ['kind'], equals: 'comment.added' },
    },
    select: { meta: true },
  });
  return commentIdsFromMeta(rows.map((r) => r.meta));
}

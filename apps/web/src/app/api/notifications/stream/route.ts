import type { NextRequest } from 'next/server';
import { prisma, NotificationStatus } from '@hmp/db';
import { getSessionUser } from '@hmp/auth';
import { createUnreadStream } from '@/lib/notification-stream';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function queryUnread(userId: string) {
  const [unread, recent] = await Promise.all([
    prisma.notification.count({
      where: {
        userId,
        channel: 'IN_PORTAL',
        status: { in: [NotificationStatus.PENDING, NotificationStatus.SENT] },
      },
    }),
    prisma.notification.findMany({
      where: { userId, channel: 'IN_PORTAL' },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, subject: true, body: true, link: true, createdAt: true, status: true },
    }),
  ]);
  return { unread, recent };
}

export async function GET(req: NextRequest) {
  const me = await getSessionUser();
  if (!me) return new Response('Unauthorized', { status: 401 });

  return new Response(
    createUnreadStream(() => queryUnread(me.id), req.signal),
    {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store, no-transform',
        Connection: 'keep-alive',
      },
    },
  );
}

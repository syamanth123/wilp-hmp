import type { NextRequest } from 'next/server';
import { prisma, NotificationStatus } from '@hmp/db';
import { getSessionUser } from '@hmp/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TICK_MS = 10_000;
const HEARTBEAT_MS = 25_000;
const MAX_RUNTIME_MS = 5 * 60_000;

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

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      const heartbeat = () => controller.enqueue(encoder.encode(`: ping\n\n`));

      let lastUnread = -1;
      let cancelled = false;

      const tick = async () => {
        if (cancelled) return;
        try {
          const snap = await queryUnread(me.id);
          if (snap.unread !== lastUnread) {
            lastUnread = snap.unread;
            send('notification', snap);
          }
        } catch (err) {
          console.error('[notifications/stream] tick failed', err);
        }
      };

      // Initial push.
      await tick();

      const tickTimer = setInterval(tick, TICK_MS);
      const hbTimer = setInterval(heartbeat, HEARTBEAT_MS);
      const maxRuntime = setTimeout(() => {
        cancelled = true;
        clearInterval(tickTimer);
        clearInterval(hbTimer);
        controller.close();
      }, MAX_RUNTIME_MS);

      req.signal.addEventListener('abort', () => {
        cancelled = true;
        clearInterval(tickTimer);
        clearInterval(hbTimer);
        clearTimeout(maxRuntime);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
    },
  });
}

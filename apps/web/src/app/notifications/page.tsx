import { redirect } from 'next/navigation';
import Link from 'next/link';
import { prisma, NotificationStatus } from '@hmp/db';
import { getSessionUser } from '@hmp/auth';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@hmp/ui';
import { markAllReadAction, markReadAction } from './actions';

const PAGE_SIZE = 25;

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams?: { page?: string; filter?: string };
}) {
  const me = await getSessionUser();
  if (!me) redirect('/login');

  const page = Math.max(1, Number(searchParams?.page ?? '1') || 1);
  const filter = searchParams?.filter === 'unread' ? 'unread' : 'all';

  const where =
    filter === 'unread'
      ? {
          userId: me.id,
          channel: 'IN_PORTAL' as const,
          status: { in: [NotificationStatus.PENDING, NotificationStatus.SENT] },
        }
      : { userId: me.id, channel: 'IN_PORTAL' as const };

  const [rows, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.notification.count({ where }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Notifications</h1>
          <p className="text-muted-foreground text-sm">In-portal messages from workflow events.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/notifications?filter=${filter === 'unread' ? 'all' : 'unread'}`}
            className="text-muted-foreground text-sm underline"
          >
            {filter === 'unread' ? 'Show all' : 'Show unread'}
          </Link>
          <form
            action={async () => {
              'use server';
              await markAllReadAction();
            }}
          >
            <Button type="submit" variant="outline" size="sm">
              Mark all read
            </Button>
          </form>
        </div>
      </div>

      {rows.length === 0 && (
        <Card>
          <CardContent className="text-muted-foreground p-6 text-sm">Nothing to show.</CardContent>
        </Card>
      )}

      {rows.map((n) => {
        const isUnread = n.status !== NotificationStatus.READ;
        return (
          <Card key={n.id} className={isUnread ? '' : 'opacity-70'}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-3">
                <CardTitle className="text-base">{n.subject}</CardTitle>
                {isUnread && <Badge>Unread</Badge>}
              </div>
              <CardDescription className="text-xs">
                {new Date(n.createdAt).toLocaleString()}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm">{n.body}</p>
              <div className="flex items-center gap-2">
                {n.link && (
                  <Link href={n.link} className="text-sm underline">
                    Open
                  </Link>
                )}
                {isUnread && (
                  <form
                    action={async (fd) => {
                      'use server';
                      await markReadAction(fd);
                    }}
                  >
                    <input type="hidden" name="id" value={n.id} />
                    <Button type="submit" variant="ghost" size="sm">
                      Mark read
                    </Button>
                  </form>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2 text-sm">
          <span className="text-muted-foreground">
            Page {page} of {totalPages} · {total} total
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={`/notifications?page=${page - 1}&filter=${filter}`}
                className="rounded border px-3 py-1"
              >
                Previous
              </Link>
            )}
            {page < totalPages && (
              <Link
                href={`/notifications?page=${page + 1}&filter=${filter}`}
                className="rounded border px-3 py-1"
              >
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

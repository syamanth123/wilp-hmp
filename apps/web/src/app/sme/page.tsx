import Link from 'next/link';
import { prisma, RoleName, SmeNominationStatus } from '@hmp/db';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  buttonVariants,
} from '@hmp/ui';
import { getSessionUser, requireRole } from '@hmp/auth';

const RECENT_PENDING_LIMIT = 5;
const COMPLETED_WINDOW_DAYS = 90;

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export default async function SmeOverview() {
  const me = requireRole(await getSessionUser(), RoleName.SME);
  const since = new Date(Date.now() - COMPLETED_WINDOW_DAYS * 86_400_000);

  const [pendingCount, acceptedCount, completedCount, recentPending] = await Promise.all([
    prisma.smeNomination.count({
      where: { smeUserId: me.id, status: SmeNominationStatus.PENDING },
    }),
    prisma.smeNomination.count({
      where: { smeUserId: me.id, status: SmeNominationStatus.ACCEPTED },
    }),
    prisma.smeNomination.count({
      where: {
        smeUserId: me.id,
        status: SmeNominationStatus.COMPLETED,
        completedAt: { gte: since },
      },
    }),
    prisma.smeNomination.findMany({
      where: { smeUserId: me.id, status: SmeNominationStatus.PENDING },
      orderBy: { createdAt: 'desc' },
      take: RECENT_PENDING_LIMIT,
      select: {
        id: true,
        topic: true,
        createdAt: true,
        nominatedBy: { select: { name: true } },
        request: {
          select: {
            refNo: true,
            offering: { select: { course: { select: { code: true, title: true } } } },
          },
        },
      },
    }),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Welcome, {me.name}</h1>
        <p className="text-muted-foreground text-sm">
          Subject Matter Expert dashboard. Review nominations and advise on handouts.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Pending nominations</CardDescription>
            <CardTitle className="text-3xl">{pendingCount}</CardTitle>
          </CardHeader>
          <CardContent>
            <Link
              href="/sme/nominations?tab=pending"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              Review
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>In progress (accepted)</CardDescription>
            <CardTitle className="text-3xl">{acceptedCount}</CardTitle>
          </CardHeader>
          <CardContent>
            <Link
              href="/sme/nominations?tab=accepted"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              Open
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Completed (last {COMPLETED_WINDOW_DAYS} days)</CardDescription>
            <CardTitle className="text-3xl">{completedCount}</CardTitle>
          </CardHeader>
          <CardContent>
            <Link
              href="/sme/nominations?tab=completed"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              History
            </Link>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent pending nominations</CardTitle>
          <CardDescription>The 5 most recent nominations awaiting your response.</CardDescription>
        </CardHeader>
        <CardContent>
          {recentPending.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No pending nominations. You&apos;ll see new ones here when a PC nominates you.
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {recentPending.map((n) => (
                <li key={n.id} className="flex items-start justify-between gap-3 p-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs">{n.request.refNo}</span>
                      <span className="font-medium">{n.request.offering.course.code}</span>
                      <span className="text-muted-foreground">{n.request.offering.course.title}</span>
                    </div>
                    <div className="mt-1 text-sm">{truncate(n.topic, 140)}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Nominated by {n.nominatedBy.name} ·{' '}
                      {new Date(n.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <Link
                    href={`/sme/nominations/${n.id}`}
                    className={buttonVariants({ variant: 'outline', size: 'sm' })}
                  >
                    Open
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

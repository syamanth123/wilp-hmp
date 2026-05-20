import Link from 'next/link';
import { prisma, RoleName, SmeNominationStatus } from '@hmp/db';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@hmp/ui';
import { getSessionUser, requireRole } from '@hmp/auth';

const TABS = [
  { key: 'pending', label: 'Pending', status: SmeNominationStatus.PENDING },
  { key: 'accepted', label: 'Accepted', status: SmeNominationStatus.ACCEPTED },
  { key: 'completed', label: 'Completed', status: SmeNominationStatus.COMPLETED },
  { key: 'declined', label: 'Declined', status: SmeNominationStatus.DECLINED },
] as const;

type TabKey = (typeof TABS)[number]['key'];

const STATUS_BADGE_VARIANT: Record<
  SmeNominationStatus,
  'secondary' | 'success' | 'destructive' | 'outline'
> = {
  PENDING: 'secondary',
  ACCEPTED: 'success',
  DECLINED: 'destructive',
  COMPLETED: 'outline',
};

export default async function SmeNominationsList({
  searchParams,
}: {
  searchParams?: { tab?: string };
}) {
  const me = requireRole(await getSessionUser(), RoleName.SME);
  const rawTab = searchParams?.tab as TabKey | undefined;
  const tab = TABS.find((t) => t.key === rawTab) ?? TABS[0];

  const nominations = await prisma.smeNomination.findMany({
    where: { smeUserId: me.id, status: tab.status },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      topic: true,
      status: true,
      createdAt: true,
      nominatedBy: { select: { name: true } },
      request: {
        select: {
          refNo: true,
          offering: { select: { course: { select: { code: true, title: true } } } },
        },
      },
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>My nominations</CardTitle>
        <nav className="mt-2 flex flex-wrap gap-1 text-sm">
          {TABS.map((t) => {
            const active = t.key === tab.key;
            return (
              <Link
                key={t.key}
                href={`/sme/nominations?tab=${t.key}`}
                className={`rounded-md px-3 py-1.5 ${
                  active
                    ? 'bg-accent text-foreground font-medium'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
      </CardHeader>
      <CardContent>
        {nominations.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No nominations in this view.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ref</TableHead>
                <TableHead>Course</TableHead>
                <TableHead>Topic</TableHead>
                <TableHead>Nominated by</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {nominations.map((n) => (
                <TableRow key={n.id}>
                  <TableCell className="font-mono text-xs">{n.request.refNo}</TableCell>
                  <TableCell>
                    <div className="font-medium">{n.request.offering.course.code}</div>
                    <div className="text-muted-foreground text-xs">
                      {n.request.offering.course.title}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-xs truncate" title={n.topic}>
                    {n.topic}
                  </TableCell>
                  <TableCell className="text-xs">{n.nominatedBy.name}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {new Date(n.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGE_VARIANT[n.status]}>{n.status}</Badge>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/sme/nominations/${n.id}`}
                      className="text-primary text-sm underline-offset-4 hover:underline"
                    >
                      Open
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

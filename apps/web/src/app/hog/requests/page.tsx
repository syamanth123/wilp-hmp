import Link from 'next/link';
import { prisma, HandoutStatus } from '@hmp/db';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  buttonVariants,
} from '@hmp/ui';
import { StatusBadge } from '@/components/status-badge';

const PAGE_SIZE = 25;

// HOG-owned lifecycle slice — surface every state HOG can act on or observe.
const HOG_STATUSES: HandoutStatus[] = [
  HandoutStatus.REQUESTED,
  HandoutStatus.ALLOCATED,
  HandoutStatus.ASSIGNED,
  HandoutStatus.IN_PROGRESS,
  HandoutStatus.SUBMITTED,
  HandoutStatus.UNDER_REVIEW,
  HandoutStatus.REWORK_REQUESTED,
  HandoutStatus.APPROVED,
  HandoutStatus.PUBLISHED,
];

export default async function HOGRequestList({
  searchParams,
}: {
  searchParams?: { status?: string; page?: string };
}) {
  const status = (searchParams?.status as HandoutStatus | undefined) ?? undefined;
  const page = Math.max(1, parseInt(searchParams?.page ?? '1', 10) || 1);

  const where = status ? { status } : { status: { in: HOG_STATUSES } };
  const [total, requests] = await Promise.all([
    prisma.handoutRequest.count({ where }),
    prisma.handoutRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        offering: { include: { course: true, semester: { include: { programme: true } } } },
      },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Handout requests</CardTitle>
        <form className="flex gap-2 text-sm" action="/hog/requests">
          <select
            name="status"
            defaultValue={status ?? ''}
            className="h-9 rounded-md border bg-background px-2 text-sm"
          >
            <option value="">All HOG statuses</option>
            {HOG_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button className={buttonVariants({ variant: 'outline', size: 'sm' })}>Filter</button>
        </form>
      </CardHeader>
      <CardContent>
        {requests.length === 0 ? (
          <p className="text-sm text-muted-foreground">No requests in scope.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ref</TableHead>
                <TableHead>Course</TableHead>
                <TableHead>Programme · Semester</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.refNo}</TableCell>
                  <TableCell>
                    <div className="font-medium">{r.offering.course.title}</div>
                    <div className="text-xs text-muted-foreground">{r.offering.course.code}</div>
                  </TableCell>
                  <TableCell className="text-xs">
                    {r.offering.semester.programme.code} · {r.offering.semester.name}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={r.status} />
                  </TableCell>
                  <TableCell>
                    <Link className="text-sm text-primary underline-offset-4 hover:underline" href={`/hog/requests/${r.id}`}>
                      Open
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
            <span>
              Page {page} of {totalPages} · {total} total
            </span>
            <div className="flex gap-2">
              {page > 1 && (
                <Link
                  href={`/hog/requests?${new URLSearchParams({ ...(status ? { status } : {}), page: String(page - 1) })}`}
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                >
                  Prev
                </Link>
              )}
              {page < totalPages && (
                <Link
                  href={`/hog/requests?${new URLSearchParams({ ...(status ? { status } : {}), page: String(page + 1) })}`}
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                >
                  Next
                </Link>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

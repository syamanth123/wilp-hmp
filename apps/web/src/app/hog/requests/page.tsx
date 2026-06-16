import Link from 'next/link';
import { prisma, HandoutStatus, ApprovalStage, ApprovalDecision } from '@hmp/db';
import {
  Badge,
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

  // Prompt 22: flag REQUESTED rows whose prior allocation PC rejected. On a
  // REQUESTED request a PC_REVIEW/REWORK approval can only be an allocation
  // reject (content rework lands in REWORK_REQUESTED, never REQUESTED), so this
  // is unambiguous. One batched query for the page's REQUESTED rows.
  const requestedIds = requests
    .filter((r) => r.status === HandoutStatus.REQUESTED)
    .map((r) => r.id);
  const rejectedSet = new Set<string>();
  if (requestedIds.length > 0) {
    const rejects = await prisma.approval.findMany({
      where: {
        requestId: { in: requestedIds },
        stage: ApprovalStage.PC_REVIEW,
        decision: ApprovalDecision.REWORK,
      },
      select: { requestId: true },
    });
    for (const a of rejects) rejectedSet.add(a.requestId);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Handout requests</CardTitle>
        <form className="flex gap-2 text-sm" action="/hog/requests">
          <select
            name="status"
            defaultValue={status ?? ''}
            className="bg-background h-9 rounded-md border px-2 text-sm"
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
          <p className="text-muted-foreground text-sm">No requests in scope.</p>
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
                    <div className="text-muted-foreground text-xs">{r.offering.course.code}</div>
                  </TableCell>
                  <TableCell className="text-xs">
                    {r.offering.semester.programme.code} · {r.offering.semester.name}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={r.status} />
                      {rejectedSet.has(r.id) && (
                        <Badge variant="outline" className="border-amber-400 text-amber-700">
                          PC-rejected · re-allocate
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Link
                      className="text-primary text-sm underline-offset-4 hover:underline"
                      href={`/hog/requests/${r.id}`}
                    >
                      Open
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {totalPages > 1 && (
          <div className="text-muted-foreground mt-4 flex items-center justify-between text-sm">
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

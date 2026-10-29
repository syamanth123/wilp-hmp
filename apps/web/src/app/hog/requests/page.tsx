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
import { RequestListToolbar } from '@/components/request-list-toolbar';
import { filterQuery, listWhere, parseListFilter } from '@/lib/request-views';

const PAGE_SIZE = 25;

export default async function HOGRequestList({
  searchParams,
}: {
  searchParams?: { status?: string; view?: string; page?: string };
}) {
  // Unknown or out-of-scope filters in the address are ignored (see
  // lib/request-views.ts); the dashboard card that links here counts the same query.
  const filter = parseListFilter('HOG', searchParams);
  const page = Math.max(1, parseInt(searchParams?.page ?? '1', 10) || 1);

  const where = listWhere('HOG', '', filter);
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
      </CardHeader>
      <CardContent className="space-y-4">
        <RequestListToolbar role="HOG" filter={filter} total={total} />
        {requests.length === 0 ? (
          <p className="text-muted-foreground text-sm">No requests to show.</p>
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
                <TableRow key={r.id} data-testid="request-row">
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
                  href={`C:/Program Files/Git/hog/requests${filterQuery(filter, page - 1)}`}
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                >
                  Prev
                </Link>
              )}
              {page < totalPages && (
                <Link
                  href={`C:/Program Files/Git/hog/requests${filterQuery(filter, page + 1)}`}
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

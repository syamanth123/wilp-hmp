import Link from 'next/link';
import { prisma } from '@hmp/db';
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
import { RequestListToolbar } from '@/components/request-list-toolbar';
import { filterQuery, listWhere, parseListFilter } from '@/lib/request-views';

const PAGE_SIZE = 25;

export default async function PCRequestList({
  searchParams,
}: {
  searchParams?: { status?: string; view?: string; page?: string };
}) {
  // Unknown or out-of-scope filters in the address are ignored (see
  // lib/request-views.ts); the dashboard card that links here counts the same query.
  const filter = parseListFilter('PC', searchParams);
  const page = Math.max(1, parseInt(searchParams?.page ?? '1', 10) || 1);

  const where = listWhere('PC', '', filter);
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
      </CardHeader>
      <CardContent className="space-y-4">
        <RequestListToolbar role="PC" filter={filter} total={total} />
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
                    <StatusBadge status={r.status} />
                  </TableCell>
                  <TableCell>
                    <Link
                      className="text-primary text-sm underline-offset-4 hover:underline"
                      href={`/pc/requests/${r.id}`}
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
                  href={`C:/Program Files/Git/pc/requests${filterQuery(filter, page - 1)}`}
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                >
                  Prev
                </Link>
              )}
              {page < totalPages && (
                <Link
                  href={`C:/Program Files/Git/pc/requests${filterQuery(filter, page + 1)}`}
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

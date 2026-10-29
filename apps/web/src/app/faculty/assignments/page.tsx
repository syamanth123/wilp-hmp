import Link from 'next/link';
import { prisma, RoleName } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
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

export default async function FacultyAssignmentsList({
  searchParams,
}: {
  searchParams?: { status?: string; view?: string; page?: string };
}) {
  const me = requireRole(await getSessionUser(), RoleName.FACULTY);
  // Unknown or out-of-scope filters in the address are ignored (see
  // lib/request-views.ts); the dashboard card that links here counts the same query.
  const filter = parseListFilter('FACULTY', searchParams);
  const page = Math.max(1, parseInt(searchParams?.page ?? '1', 10) || 1);

  const where = listWhere('FACULTY', me.id, filter);

  const [total, requests] = await Promise.all([
    prisma.handoutRequest.count({ where }),
    prisma.handoutRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        offering: { include: { course: true, semester: { include: { programme: true } } } },
        assignments: { where: { facultyId: me.id, active: true }, take: 1 },
      },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>My assignments</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <RequestListToolbar role="FACULTY" filter={filter} total={total} />
        {requests.length === 0 ? (
          <p className="text-muted-foreground text-sm">You have no assignments in this view.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ref</TableHead>
                <TableHead>Course</TableHead>
                <TableHead>Programme · Semester</TableHead>
                <TableHead>Accepted</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((r) => {
                const a = r.assignments[0];
                return (
                  <TableRow key={r.id} data-testid="request-row">
                    <TableCell className="font-mono text-xs">{r.refNo}</TableCell>
                    <TableCell>
                      <div className="font-medium">{r.offering.course.title}</div>
                      <div className="text-muted-foreground text-xs">{r.offering.course.code}</div>
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.offering.semester.programme.code} · {r.offering.semester.name}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {a?.acceptedAt ? new Date(a.acceptedAt).toLocaleDateString() : 'pending'}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={r.status} />
                    </TableCell>
                    <TableCell>
                      <Link
                        className="text-primary text-sm underline-offset-4 hover:underline"
                        href={`/faculty/assignments/${r.id}`}
                      >
                        Open
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
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
                  href={`C:/Program Files/Git/faculty/assignments${filterQuery(filter, page - 1)}`}
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                >
                  Prev
                </Link>
              )}
              {page < totalPages && (
                <Link
                  href={`C:/Program Files/Git/faculty/assignments${filterQuery(filter, page + 1)}`}
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

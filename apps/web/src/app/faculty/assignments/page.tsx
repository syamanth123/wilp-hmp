import Link from 'next/link';
import { prisma, HandoutStatus, RoleName } from '@hmp/db';
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

const PAGE_SIZE = 25;

const FACULTY_STATUSES: HandoutStatus[] = [
  HandoutStatus.ASSIGNED,
  HandoutStatus.IN_PROGRESS,
  HandoutStatus.SUBMITTED,
  HandoutStatus.UNDER_REVIEW,
  HandoutStatus.REWORK_REQUESTED,
  HandoutStatus.APPROVED,
  HandoutStatus.PUBLISHED,
];

export default async function FacultyAssignmentsList({
  searchParams,
}: {
  searchParams?: { status?: string; page?: string };
}) {
  const me = requireRole(await getSessionUser(), RoleName.FACULTY);
  const status = (searchParams?.status as HandoutStatus | undefined) ?? undefined;
  const page = Math.max(1, parseInt(searchParams?.page ?? '1', 10) || 1);

  const where = {
    assignments: { some: { facultyId: me.id, active: true } },
    ...(status ? { status } : { status: { in: FACULTY_STATUSES } }),
  };

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
        <form className="flex gap-2 text-sm" action="/faculty/assignments">
          <select
            name="status"
            defaultValue={status ?? ''}
            className="bg-background h-9 rounded-md border px-2 text-sm"
          >
            <option value="">All statuses</option>
            {FACULTY_STATUSES.map((s) => (
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
                  <TableRow key={r.id}>
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
                  href={`/faculty/assignments?${new URLSearchParams({ ...(status ? { status } : {}), page: String(page - 1) })}`}
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                >
                  Prev
                </Link>
              )}
              {page < totalPages && (
                <Link
                  href={`/faculty/assignments?${new URLSearchParams({ ...(status ? { status } : {}), page: String(page + 1) })}`}
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

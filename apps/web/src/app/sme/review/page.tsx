import Link from 'next/link';
import { prisma, RoleName } from '@hmp/db';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@hmp/ui';
import { getSessionUser, requireRole } from '@hmp/auth';
import { StatusBadge } from '@/components/status-badge';
import { RequestListToolbar } from '@/components/request-list-toolbar';
import { listWhere, parseListFilter } from '@/lib/request-views';
import { formatDate } from '@/lib/format-date';

// Workflow detail/list pages MUST be force-dynamic (RSC caching vs revalidate).
export const dynamic = 'force-dynamic';

/**
 * SME approval queue (Prompt 12-b). Replaces the advisory /sme/nominations
 * list. Shows handouts in SME_REVIEW assigned to the signed-in SME — the
 * ones awaiting their approve/revert decision. ?view=assigned lists every
 * handout the SME is assigned to, in any status (the dashboard's "Assigned to
 * you" card links there and counts the same query).
 */
export default async function SmeReviewQueue({
  searchParams,
}: {
  searchParams?: { view?: string; status?: string };
}) {
  const me = requireRole(await getSessionUser(), RoleName.SME);
  const filter = parseListFilter('SME', searchParams);
  const where = listWhere('SME', me.id, filter);

  const rows = await prisma.handoutRequest.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      refNo: true,
      status: true,
      offering: { select: { course: { select: { code: true, title: true } } } },
      assignments: {
        where: { active: true },
        select: { faculty: { select: { name: true } } },
        take: 1,
      },
    },
  });

  // "Submitted" = when the faculty member last sent it for SME review (the
  // workflow's audit entry), not the last time anything changed on the row.
  const submits = rows.length
    ? await prisma.auditLog.findMany({
        where: {
          requestId: { in: rows.map((r) => r.id) },
          action: 'handout.transition.SME_REVIEW_REQUESTED',
        },
        orderBy: { createdAt: 'desc' },
        select: { requestId: true, createdAt: true },
      })
    : [];
  const submittedAt = new Map<string, Date>();
  for (const a of submits) {
    if (a.requestId && !submittedAt.has(a.requestId)) submittedAt.set(a.requestId, a.createdAt);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Review queue</CardTitle>
          <CardDescription>
            Handouts sent to you as the subject expert. Approve one to forward it to the Programme
            Committee, or ask for changes to send it back to the faculty member.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <RequestListToolbar
            role="SME"
            filter={filter}
            total={rows.length}
            showStatusFilter={false}
          />
          {filter.view?.key === 'awaiting' && (
            <p className="text-sm">
              <a
                href="/sme/review?view=assigned"
                className="text-primary underline-offset-4 hover:underline"
              >
                See all handouts assigned to you
              </a>
            </p>
          )}
          {rows.length === 0 ? (
            <p className="text-muted-foreground text-sm" data-testid="sme-review-empty">
              Nothing awaiting your review right now.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ref</TableHead>
                  <TableHead>Course</TableHead>
                  <TableHead>Faculty</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Submitted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} data-testid={`sme-review-row-${r.id}`}>
                    <TableCell className="font-mono text-xs">
                      <Link href={`/sme/review/${r.id}`} className="text-blue-700 underline">
                        {r.refNo}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.offering.course.code} — {r.offering.course.title}
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.assignments[0]?.faculty.name ?? '—'}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={r.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {formatDate(submittedAt.get(r.id))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

import Link from 'next/link';
import { prisma, RoleName, HandoutStatus } from '@hmp/db';
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

// Workflow detail/list pages MUST be force-dynamic (RSC caching vs revalidate).
export const dynamic = 'force-dynamic';

/**
 * SME approval queue (Prompt 12-b). Replaces the advisory /sme/nominations
 * list. Shows handouts in SME_REVIEW assigned to the signed-in SME — the
 * ones awaiting their approve/revert decision.
 */
export default async function SmeReviewQueue() {
  const me = requireRole(await getSessionUser(), RoleName.SME);

  const rows = await prisma.handoutRequest.findMany({
    where: {
      status: HandoutStatus.SME_REVIEW,
      smeAssignment: { smeUserId: me.id },
    },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      refNo: true,
      updatedAt: true,
      offering: { select: { course: { select: { code: true, title: true } } } },
      assignments: {
        where: { active: true },
        select: { faculty: { select: { name: true } } },
        take: 1,
      },
    },
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>SME approval queue</CardTitle>
          <CardDescription>
            Handouts submitted for your Subject Matter Expert review. Approve to forward to the
            Programme Committee, or request changes to send back to faculty.
          </CardDescription>
        </CardHeader>
        <CardContent>
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
                    <TableCell className="text-muted-foreground text-xs">
                      {r.updatedAt.toLocaleDateString()}
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

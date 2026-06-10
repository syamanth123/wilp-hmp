import Link from 'next/link';
import { prisma, RoleName, HandoutStatus, ApprovalStage, ApprovalDecision } from '@hmp/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, buttonVariants } from '@hmp/ui';
import { getSessionUser, requireRole } from '@hmp/auth';

// Workflow landing pages MUST be force-dynamic (RSC caching vs revalidate).
export const dynamic = 'force-dynamic';

const RECENT_PENDING_LIMIT = 5;
const COMPLETED_WINDOW_DAYS = 90;

/**
 * SME landing (Prompt 12-b). Rewritten from the advisory nomination dashboard
 * to the approval-queue model: the SME is a designated approval gate, so the
 * dashboard surfaces handouts awaiting their decision, their assigned
 * portfolio, and recent approvals — all sourced from SmeAssignment + Approval
 * rows (no SmeNomination).
 */
export default async function SmeOverview() {
  const me = requireRole(await getSessionUser(), RoleName.SME);
  const since = new Date(Date.now() - COMPLETED_WINDOW_DAYS * 86_400_000);

  const [awaitingCount, assignedCount, approvedCount, recentPending] = await Promise.all([
    // Actionable: handouts in SME_REVIEW assigned to me.
    prisma.handoutRequest.count({
      where: { status: HandoutStatus.SME_REVIEW, smeAssignment: { smeUserId: me.id } },
    }),
    // Portfolio: every handout I'm the designated SME for, any status.
    prisma.smeAssignment.count({ where: { smeUserId: me.id } }),
    // Recent approvals authored by me (Approval rows, not assignment state).
    prisma.approval.count({
      where: {
        reviewerId: me.id,
        stage: ApprovalStage.SME_REVIEW,
        decision: ApprovalDecision.APPROVED,
        decidedAt: { gte: since },
      },
    }),
    prisma.handoutRequest.findMany({
      where: { status: HandoutStatus.SME_REVIEW, smeAssignment: { smeUserId: me.id } },
      orderBy: { updatedAt: 'desc' },
      take: RECENT_PENDING_LIMIT,
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
    }),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Welcome, {me.name}</h1>
        <p className="text-muted-foreground text-sm">
          Subject Matter Expert dashboard. Approve faculty submissions or send them back with
          comments before they reach the Programme Committee.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Awaiting your review</CardDescription>
            <CardTitle className="text-3xl">{awaitingCount}</CardTitle>
          </CardHeader>
          <CardContent>
            <Link href="/sme/review" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              Review
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Assigned to you</CardDescription>
            <CardTitle className="text-3xl">{assignedCount}</CardTitle>
          </CardHeader>
          <CardContent>
            <Link href="/sme/review" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              Open queue
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Approved (last {COMPLETED_WINDOW_DAYS} days)</CardDescription>
            <CardTitle className="text-3xl">{approvedCount}</CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-muted-foreground text-xs">
              Forwarded to the Programme Committee.
            </span>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Awaiting your review</CardTitle>
          <CardDescription>
            The {RECENT_PENDING_LIMIT} most recent handouts in your queue.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {recentPending.length === 0 ? (
            <p className="text-muted-foreground text-sm" data-testid="sme-overview-empty">
              Nothing awaiting your review. You&apos;ll see handouts here when faculty submit work
              on the courses you&apos;re the SME for.
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {recentPending.map((r) => (
                <li key={r.id} className="flex items-start justify-between gap-3 p-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs">{r.refNo}</span>
                      <span className="font-medium">{r.offering.course.code}</span>
                      <span className="text-muted-foreground">{r.offering.course.title}</span>
                    </div>
                    <div className="text-muted-foreground mt-1 text-xs">
                      Faculty: {r.assignments[0]?.faculty.name ?? '—'} ·{' '}
                      {new Date(r.updatedAt).toLocaleDateString()}
                    </div>
                  </div>
                  <Link
                    href={`/sme/review/${r.id}`}
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

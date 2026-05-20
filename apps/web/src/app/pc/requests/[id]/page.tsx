import { notFound } from 'next/navigation';
import { prisma, HandoutStatus, RoleName } from '@hmp/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@hmp/ui';
import { StatusBadge } from '@/components/status-badge';
import { StatusTimeline } from '@/components/status-timeline';
import { ApprovalsList } from '@/components/approvals-list';
import { FacultyAssignmentsList } from '@/components/faculty-assignments-list';
import { HandoutViewer } from '@/components/handout-viewer';
import { VersionList } from '@/components/version-list';
import { VersionDiff } from '@/components/version-diff';
import { CommentThread } from '@/components/comment-thread';
import { listVersions } from '@/lib/handout-versioning';
import { QualityReportCard } from '@/components/quality-report-card';
import { AssignmentPanel } from './assignment-panel';
import { ReviewPanel } from './review-panel';
import {
  SmeNominationsPanel,
  type ExistingNomination,
  type SmeOption,
} from './sme-nominations-panel';
import { NOMINATION_ALLOWED_STATUSES } from './sme-nomination';

// Workflow detail pages MUST be force-dynamic. See ic/requests/[id]/page.tsx
// for the rationale (Next.js production-build RSC caching vs revalidatePath).
export const dynamic = 'force-dynamic';

export default async function PCRequestDetail({ params }: { params: { id: string } }) {
  const request = await prisma.handoutRequest.findUnique({
    where: { id: params.id },
    include: {
      offering: { include: { course: true, semester: { include: { programme: true } } } },
      initiator: { select: { name: true, email: true } },
      handout: { include: { currentVersion: true } },
    },
  });
  if (!request) notFound();
  const handout = request.handout;
  const versions = handout ? await listVersions(handout.id) : [];

  // SME nominations: list existing + fetch active SME users for the dropdown.
  // Both queries are cheap (small tables, indexed) and the page is already
  // force-dynamic so they always reflect the latest state.
  const [nominationRows, smeUsers] = await Promise.all([
    prisma.smeNomination.findMany({
      where: { requestId: request.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        topic: true,
        notes: true,
        status: true,
        createdAt: true,
        smeUser: { select: { name: true, email: true } },
        nominatedBy: { select: { name: true } },
      },
    }),
    prisma.user.findMany({
      where: {
        active: true,
        roles: { some: { role: { name: RoleName.SME } } },
      },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, email: true },
    }),
  ]);
  const nominations: ExistingNomination[] = nominationRows.map((n) => ({
    id: n.id,
    topic: n.topic,
    notes: n.notes,
    status: n.status,
    createdAt: n.createdAt.toISOString(),
    smeUser: n.smeUser,
    nominatedBy: n.nominatedBy,
  }));
  const smeOptions: SmeOption[] = smeUsers;
  const canNominate = NOMINATION_ALLOWED_STATUSES.has(request.status);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="font-mono text-base">{request.refNo}</CardTitle>
            <CardDescription>
              {request.offering.course.code} — {request.offering.course.title}
            </CardDescription>
            <p className="text-muted-foreground mt-1 text-xs">
              {request.offering.semester.programme.code} · {request.offering.semester.name} ·{' '}
              initiated by {request.initiator.name}
            </p>
          </div>
          <StatusBadge status={request.status} />
        </CardHeader>
      </Card>

      {request.status === HandoutStatus.ALLOCATED && (
        <Card>
          <CardHeader>
            <CardTitle>Confirm assignment</CardTitle>
            <CardDescription>
              Review HOG's allocation and confirm to notify faculty.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AssignmentPanel requestId={request.id} />
          </CardContent>
        </Card>
      )}

      {request.status === HandoutStatus.SUBMITTED && (
        <Card>
          <CardHeader>
            <CardTitle>Review submission</CardTitle>
            <CardDescription>
              Approve to forward to HOG, or request rework with comments.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ReviewPanel requestId={request.id} />
          </CardContent>
        </Card>
      )}

      {(nominations.length > 0 || canNominate) && (
        <Card>
          <CardHeader>
            <CardTitle>SME nominations</CardTitle>
            <CardDescription>
              Invite a Subject Matter Expert to advise on this handout. Their input is advisory
              and does not block the workflow.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SmeNominationsPanel
              requestId={request.id}
              canNominate={canNominate}
              smeOptions={smeOptions}
              nominations={nominations}
            />
          </CardContent>
        </Card>
      )}

      {handout && handout.currentVersion && (
        <Card>
          <CardHeader>
            <CardTitle>Handout (v{handout.currentVersion.versionNo})</CardTitle>
            <CardDescription>Latest version submitted by faculty.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <HandoutViewer html={handout.currentVersion.contentHtml} />
            <VersionList handoutId={handout.id} />
            {versions.length >= 2 && (
              <VersionDiff
                handoutId={handout.id}
                fromVersion={versions[versions.length - 2]!.versionNo}
                toVersion={versions[versions.length - 1]!.versionNo}
              />
            )}
          </CardContent>
        </Card>
      )}

      {handout && <QualityReportCard handoutId={handout.id} />}

      <Card>
        <CardHeader>
          <CardTitle>Faculty</CardTitle>
        </CardHeader>
        <CardContent>
          <FacultyAssignmentsList requestId={request.id} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Approvals</CardTitle>
        </CardHeader>
        <CardContent>
          <ApprovalsList requestId={request.id} />
        </CardContent>
      </Card>

      {handout && (
        <Card>
          <CardHeader>
            <CardTitle>Discussion</CardTitle>
            <CardDescription>Visible to IC, HOG, PC and the assigned faculty.</CardDescription>
          </CardHeader>
          <CardContent>
            <CommentThread handoutId={handout.id} requestId={request.id} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Lifecycle</CardTitle>
        </CardHeader>
        <CardContent>
          <StatusTimeline requestId={request.id} />
        </CardContent>
      </Card>
    </div>
  );
}

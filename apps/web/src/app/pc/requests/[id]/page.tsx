import { notFound } from 'next/navigation';
import { prisma, HandoutStatus, resolveHandoutHtml } from '@hmp/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@hmp/ui';
import { StatusBadge } from '@/components/status-badge';
import { StatusTimeline } from '@/components/status-timeline';
import { ApprovalsList } from '@/components/approvals-list';
import { FacultyAssignmentsList } from '@/components/faculty-assignments-list';
import { HandoutViewer } from '@/components/handout-viewer';
import { VersionList } from '@/components/version-list';
import { VersionDiff } from '@/components/version-diff';
import { CommentThread } from '@/components/comment-thread';
import { AttachmentsPanel } from '@/components/attachments-panel';
import { loadAttachments } from '@/lib/attachments';
import { listVersions } from '@/lib/handout-versioning';
import { QualityReportCard } from '@/components/quality-report-card';
import { AssignmentPanel } from './assignment-panel';
import { ReviewPanel } from './review-panel';

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

  const attachments = await loadAttachments(request.id);
  const handout = request.handout;
  const versions = handout ? await listVersions(handout.id) : [];

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

      {handout && handout.currentVersion && (
        <Card>
          <CardHeader>
            <CardTitle>Handout (v{handout.currentVersion.versionNo})</CardTitle>
            <CardDescription>Latest version submitted by faculty.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <HandoutViewer
              html={resolveHandoutHtml(handout.currentVersion, {
                omitInstitutionalHeader: true,
              })}
            />
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

      <Card>
        <CardHeader>
          <CardTitle>Attachments</CardTitle>
          <CardDescription>Supplementary files uploaded by the assigned faculty.</CardDescription>
        </CardHeader>
        <CardContent>
          <AttachmentsPanel
            requestId={request.id}
            initial={attachments}
            canUpload={false}
            currentUserId=""
          />
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

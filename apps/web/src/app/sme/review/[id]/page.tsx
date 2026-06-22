import { notFound } from 'next/navigation';
import { prisma, HandoutStatus, RoleName, resolveHandoutHtml } from '@hmp/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@hmp/ui';
import { getSessionUser, requireRole } from '@hmp/auth';
import { StatusBadge } from '@/components/status-badge';
import { HandoutViewer } from '@/components/handout-viewer';
import { CommentThread } from '@/components/comment-thread';
import { AttachmentsPanel } from '@/components/attachments-panel';
import { loadAttachments } from '@/lib/attachments';
import { SmeReviewPanel } from './sme-review-panel';

export const dynamic = 'force-dynamic';

/**
 * SME review detail (Prompt 12-b). Read-only handout render (same
 * HandoutViewer the PC/HOG use) + the comment thread + the approve/revert
 * panel. The panel only renders when the request is in SME_REVIEW AND the
 * signed-in SME is the assigned one — otherwise a read-only "not in your
 * queue" note (the action layer enforces the same, this is just UX).
 */
export default async function SmeReviewDetail({ params }: { params: { id: string } }) {
  const me = requireRole(await getSessionUser(), RoleName.SME);

  const request = await prisma.handoutRequest.findUnique({
    where: { id: params.id },
    include: {
      offering: { include: { course: true, semester: { include: { programme: true } } } },
      handout: { include: { currentVersion: true } },
      smeAssignment: { select: { smeUserId: true } },
    },
  });
  if (!request) notFound();

  const attachments = await loadAttachments(request.id);

  const isAssignedSme = request.smeAssignment?.smeUserId === me.id;
  const inReview = request.status === HandoutStatus.SME_REVIEW;
  const currentVersion = request.handout?.currentVersion ?? null;

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
              {request.offering.semester.programme.code} · {request.offering.semester.name}
            </p>
          </div>
          <StatusBadge status={request.status} />
        </CardHeader>
      </Card>

      {isAssignedSme && inReview ? (
        <Card>
          <CardHeader>
            <CardTitle>SME decision</CardTitle>
            <CardDescription>
              Approve to forward to the Programme Committee, or request changes to send back to
              faculty with a comment.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SmeReviewPanel requestId={request.id} />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground text-sm" data-testid="sme-review-readonly">
              {!isAssignedSme
                ? 'This handout is not assigned to you for SME review.'
                : `No decision available from status ${request.status}.`}
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Handout</CardTitle>
          <CardDescription>The version submitted for your review.</CardDescription>
        </CardHeader>
        <CardContent>
          <HandoutViewer
            html={
              currentVersion
                ? resolveHandoutHtml(currentVersion, { logoSrc: '/bits-header.png' })
                : null
            }
          />
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

      {request.handout && (
        <Card>
          <CardHeader>
            <CardTitle>Discussion</CardTitle>
            <CardDescription>
              Your comments are visible to faculty, PC, HOG, and IC.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CommentThread handoutId={request.handout.id} requestId={request.id} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

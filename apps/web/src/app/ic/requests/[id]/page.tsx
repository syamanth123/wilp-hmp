import { notFound } from 'next/navigation';
import { prisma, HandoutStatus, LmsPublishMode, resolveHandoutHtml } from '@hmp/db';
import { getPresignedDownloadUrl } from '@hmp/integrations';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@hmp/ui';
import { StatusBadge } from '@/components/status-badge';
import { DownloadMenu } from '@/components/download-menu';
import { PRIVILEGED_STATUSES } from '@/lib/export/access';
import { StatusTimeline } from '@/components/status-timeline';

// Workflow detail pages MUST be force-dynamic. Without it, Next.js production
// builds can serve a stale RSC payload from before revalidatePath propagated,
// which manifests as e2e failures where the badge shows pre-transition state
// while the DB has already committed the new status.
export const dynamic = 'force-dynamic';
import { ApprovalsList } from '@/components/approvals-list';
import { FacultyAssignmentsList } from '@/components/faculty-assignments-list';
import { HandoutViewer } from '@/components/handout-viewer';
import { VersionList } from '@/components/version-list';
import { VersionDiff } from '@/components/version-diff';
import { PublishLogs } from '@/components/publish-logs';
import { CommentThread } from '@/components/comment-thread';
import { AttachmentsPanel } from '@/components/attachments-panel';
import { loadAttachments } from '@/lib/attachments';
import { listVersions } from '@/lib/handout-versioning';
import { QualityReportCard } from '@/components/quality-report-card';
import Link from 'next/link';
import { PublishPanel } from './publish-panel';
import { ArchivePanel } from './archive-panel';

export default async function RequestDetailPage({ params }: { params: { id: string } }) {
  const request = await prisma.handoutRequest.findUnique({
    where: { id: params.id },
    include: {
      offering: { include: { course: true, semester: { include: { programme: true } } } },
      initiator: { select: { name: true, email: true } },
      attachments: true,
      handout: { include: { currentVersion: true } },
    },
  });
  if (!request) notFound();

  const attachments = await loadAttachments(request.id);

  const handout = request.handout;
  const versions = handout ? await listVersions(handout.id) : [];

  // Mode B "awaiting manual confirmation" state: an EXPORTED publish log exists
  // while the request is still APPROVED. Regenerate the download URL fresh from
  // the durable s3Key each render — the presigned URL is ephemeral, so we never
  // persist/serve a stale one. taxilaConfigured is a boolean only; the URL value
  // never crosses to the client.
  const taxilaConfigured = Boolean(process.env.TAXILA_API_URL);
  let exportDownloadUrl: string | null = null;
  if (handout && request.status === HandoutStatus.APPROVED) {
    const exportLog = await prisma.lmsPublishLog.findFirst({
      where: { handoutId: handout.id, mode: LmsPublishMode.EXPORT, status: 'EXPORTED' },
      orderBy: { publishedAt: 'desc' },
      select: { s3Key: true },
    });
    if (exportLog?.s3Key) {
      try {
        exportDownloadUrl = await getPresignedDownloadUrl(exportLog.s3Key);
      } catch {
        // Object storage unreachable — panel falls back to "Publish" state and
        // surfaces the issue on retry rather than crashing the page render.
        exportDownloadUrl = null;
      }
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="font-mono text-base">{request.refNo}</CardTitle>
            <CardDescription>
              {request.offering.course.code} — {request.offering.course.title}
            </CardDescription>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={request.status} />
            {PRIVILEGED_STATUSES.includes(request.status) && (
              <DownloadMenu requestId={request.id} />
            )}
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <Field label="Programme">
            {request.offering.semester.programme.code} — {request.offering.semester.programme.name}
          </Field>
          <Field label="Semester">{request.offering.semester.name}</Field>
          <Field label="Slot">{request.offering.slotInfo ?? '—'}</Field>
          <Field label="Initiated by">
            {request.initiator.name}{' '}
            <span className="text-muted-foreground">({request.initiator.email})</span>
          </Field>
          <Field label="Created">{new Date(request.createdAt).toLocaleString()}</Field>
          <Field label="Updated">{new Date(request.updatedAt).toLocaleString()}</Field>
          {request.notes && (
            <div className="sm:col-span-2">
              <Field label="Notes">{request.notes}</Field>
            </div>
          )}
          {request.previousHandoutUrl && (
            <div className="sm:col-span-2">
              <Field label="Previous handout">
                <a
                  className="text-primary underline-offset-4 hover:underline"
                  href={request.previousHandoutUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {request.previousHandoutUrl}
                </a>
              </Field>
            </div>
          )}
        </CardContent>
      </Card>

      {request.status === HandoutStatus.APPROVED && (
        <Card>
          <CardHeader>
            <CardTitle>Publish to LMS</CardTitle>
            <CardDescription>
              Final approval is recorded. Push the handout to Taxila.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(!request.offering.semester.examDate || !request.offering.semester.ec1Deadline) && (
              <div
                role="status"
                style={{
                  background: '#fff7ed',
                  border: '1px solid #fed7aa',
                  color: '#9a3412',
                  padding: '10px 12px',
                  borderRadius: 8,
                  fontSize: 13,
                }}
              >
                <strong>Heads up:</strong> exam date or EC1 deadline is missing for this semester.{' '}
                <Link
                  href={`/ic/semesters/${request.offering.semester.id}`}
                  className="underline underline-offset-2"
                >
                  Set them now
                </Link>
                . You can still publish — but downstream LMS sync may be incomplete.
              </div>
            )}
            <PublishPanel
              requestId={request.id}
              taxilaConfigured={taxilaConfigured}
              exportDownloadUrl={exportDownloadUrl}
            />
          </CardContent>
        </Card>
      )}

      {request.status === HandoutStatus.PUBLISHED && (
        <Card>
          <CardHeader>
            <CardTitle>Archive</CardTitle>
            <CardDescription>End-of-term: move this handout to the archive.</CardDescription>
          </CardHeader>
          <CardContent>
            <ArchivePanel requestId={request.id} />
          </CardContent>
        </Card>
      )}

      {handout && handout.currentVersion && (
        <Card>
          <CardHeader>
            <CardTitle>Handout (v{handout.currentVersion.versionNo})</CardTitle>
            <CardDescription>Latest version.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <HandoutViewer
              html={resolveHandoutHtml(handout.currentVersion, {
                logoSrc: '/bits-header.png',
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

      {handout &&
        (request.status === HandoutStatus.PUBLISHED ||
          request.status === HandoutStatus.ARCHIVED) && (
          <Card>
            <CardHeader>
              <CardTitle>LMS publish log</CardTitle>
            </CardHeader>
            <CardContent>
              <PublishLogs handoutId={handout.id} />
            </CardContent>
          </Card>
        )}

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
          <CardDescription>Every transition is recorded in the audit log.</CardDescription>
        </CardHeader>
        <CardContent>
          <StatusTimeline requestId={request.id} />
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-muted-foreground text-xs uppercase tracking-wide">{label}</div>
      <div>{children}</div>
    </div>
  );
}

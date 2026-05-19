import { notFound } from 'next/navigation';
import { prisma, HandoutStatus } from '@hmp/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@hmp/ui';
import { StatusBadge } from '@/components/status-badge';
import { StatusTimeline } from '@/components/status-timeline';
import { ApprovalsList } from '@/components/approvals-list';
import { FacultyAssignmentsList } from '@/components/faculty-assignments-list';
import { HandoutViewer } from '@/components/handout-viewer';
import { VersionList } from '@/components/version-list';
import { VersionDiff } from '@/components/version-diff';
import { PublishLogs } from '@/components/publish-logs';
import { CommentThread } from '@/components/comment-thread';
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
          </div>
          <StatusBadge status={request.status} />
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
            {(!request.offering.semester.examDate ||
              !request.offering.semester.ec1Deadline) && (
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
            <PublishPanel requestId={request.id} />
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

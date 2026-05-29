import { notFound, redirect } from 'next/navigation';
import { HandoutStatus, RoleName, SmeNominationStatus, prisma, resolveHandoutHtml } from '@hmp/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@hmp/ui';
import { getSessionUser, requireRole } from '@hmp/auth';
import { StatusBadge } from '@/components/status-badge';
import { StatusTimeline } from '@/components/status-timeline';
import { ApprovalsList } from '@/components/approvals-list';
import { HandoutViewer } from '@/components/handout-viewer';
import { VersionList } from '@/components/version-list';
import { VersionDiff } from '@/components/version-diff';
import { CommentThread } from '@/components/comment-thread';
import { SmeAdvisoryPanel } from '@/components/sme-advisory-panel';
import { loadHandoutForFaculty, listVersions } from '@/lib/handout-versioning';
import { QualityReportCard } from '@/components/quality-report-card';
import { AcceptPanel } from './accept-panel';
import { StartEditingPanel } from './start-editing-panel';
import { EditorPanel } from './editor-panel';
import { QualityPanel } from './quality-panel';

const ADVISORY_NOMINATION_STATUSES: SmeNominationStatus[] = [
  SmeNominationStatus.ACCEPTED,
  SmeNominationStatus.COMPLETED,
];

// Workflow detail pages MUST be force-dynamic. See ic/requests/[id]/page.tsx
// for the rationale (Next.js production-build RSC caching vs revalidatePath).
export const dynamic = 'force-dynamic';

const EDITABLE = new Set<HandoutStatus>([
  HandoutStatus.IN_PROGRESS,
  HandoutStatus.REWORK_REQUESTED,
]);
const READ_ONLY = new Set<HandoutStatus>([
  HandoutStatus.SUBMITTED,
  HandoutStatus.UNDER_REVIEW,
  HandoutStatus.APPROVED,
  HandoutStatus.PUBLISHED,
  HandoutStatus.ARCHIVED,
]);

export default async function FacultyAssignmentDetail({ params }: { params: { id: string } }) {
  const me = requireRole(await getSessionUser(), RoleName.FACULTY);
  const loaded = await loadHandoutForFaculty(params.id, me.id);
  if (!loaded) {
    // Either request doesn't exist or this faculty is not assigned.
    redirect('/faculty/assignments');
  }
  const { request, assignment } = loaded;
  if (!request) notFound();

  const handout = request.handout;
  const currentVersion = handout?.currentVersion ?? null;
  const status = request.status;
  const versions = handout ? await listVersions(handout.id) : [];
  const showDiff = versions.length >= 2;

  // SME advisors that are actively involved on this request. Listed in a
  // small read-only panel above the comment thread so faculty know who's
  // also weighing in. ACCEPTED + COMPLETED only — PENDING means the SME
  // hasn't engaged yet; DECLINED is irrelevant. Separate query (not a
  // deeper include on loadHandoutForFaculty) because that helper is shared
  // with other paths — extending its return shape would ripple unnecessarily.
  const advisorySmes = await prisma.smeNomination.findMany({
    where: { requestId: request.id, status: { in: ADVISORY_NOMINATION_STATUSES } },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      topic: true,
      status: true,
      completedAt: true,
      smeUser: { select: { name: true } },
    },
  });

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
              {assignment.acceptedAt
                ? `accepted ${new Date(assignment.acceptedAt).toLocaleDateString()}`
                : 'pending acceptance'}
            </p>
          </div>
          <StatusBadge status={status} />
        </CardHeader>
      </Card>

      {status === HandoutStatus.ASSIGNED && !assignment.acceptedAt && (
        <Card>
          <CardHeader>
            <CardTitle>Accept this assignment</CardTitle>
          </CardHeader>
          <CardContent>
            <AcceptPanel requestId={request.id} />
          </CardContent>
        </Card>
      )}

      {status === HandoutStatus.ASSIGNED && assignment.acceptedAt && (
        <Card>
          <CardHeader>
            <CardTitle>Start editing</CardTitle>
          </CardHeader>
          <CardContent>
            <StartEditingPanel requestId={request.id} />
          </CardContent>
        </Card>
      )}

      {EDITABLE.has(status) && handout && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>
                {status === HandoutStatus.REWORK_REQUESTED
                  ? 'Address rework + resubmit'
                  : 'Edit handout'}
              </CardTitle>
              <CardDescription>
                Each save creates a new version. Submit when ready for PC review.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <EditorPanel
                requestId={request.id}
                initialJson={currentVersion?.contentJson ?? null}
                isRework={status === HandoutStatus.REWORK_REQUESTED}
              />
            </CardContent>
          </Card>
          <Card className="lg:sticky lg:top-20 lg:col-span-1 lg:self-start">
            <CardHeader>
              <CardTitle>AI quality check</CardTitle>
              <CardDescription>
                Bloom's taxonomy + syllabus coverage on the latest saved version.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <QualityPanel requestId={request.id} />
            </CardContent>
          </Card>
        </div>
      )}

      {READ_ONLY.has(status) && (
        <Card>
          <CardHeader>
            <CardTitle>Current handout (v{currentVersion?.versionNo ?? '—'})</CardTitle>
            <CardDescription>Read-only — under review or already approved.</CardDescription>
          </CardHeader>
          <CardContent>
            <HandoutViewer
              html={
                currentVersion
                  ? resolveHandoutHtml(currentVersion, { omitInstitutionalHeader: true })
                  : null
              }
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Approvals & comments</CardTitle>
        </CardHeader>
        <CardContent>
          <ApprovalsList requestId={request.id} />
        </CardContent>
      </Card>

      {handout && versions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Versions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <VersionList handoutId={handout.id} />
            {showDiff && (
              <VersionDiff
                handoutId={handout.id}
                fromVersion={versions[versions.length - 2]!.versionNo}
                toVersion={versions[versions.length - 1]!.versionNo}
              />
            )}
          </CardContent>
        </Card>
      )}

      {handout && currentVersion && !EDITABLE.has(status) && (
        <Card>
          <CardHeader>
            <CardTitle>AI quality check</CardTitle>
            <CardDescription>
              Audit this version against Bloom's taxonomy and the course syllabus.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <QualityPanel requestId={request.id} />
          </CardContent>
        </Card>
      )}

      {handout && <QualityReportCard handoutId={handout.id} />}

      {advisorySmes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>SMEs advising on this handout</CardTitle>
            <CardDescription>
              Subject Matter Experts nominated by the Programme Committee. Their comments appear in
              the discussion below.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SmeAdvisoryPanel
              nominations={advisorySmes.map((n) => ({
                id: n.id,
                topic: n.topic,
                status: n.status as 'ACCEPTED' | 'COMPLETED',
                completedAt: n.completedAt,
                smeUser: n.smeUser,
              }))}
              commentAnchorId="comment-thread"
            />
          </CardContent>
        </Card>
      )}

      {handout && (
        <Card>
          <CardHeader>
            <CardTitle id="comment-thread">Discussion</CardTitle>
            <CardDescription>
              Visible to IC, HOG, PC, the assigned faculty, and any active SME advisors.
            </CardDescription>
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

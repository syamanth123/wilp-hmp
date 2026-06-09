import { notFound, redirect } from 'next/navigation';
import {
  HandoutStatus,
  RoleName,
  ApprovalStage,
  ApprovalDecision,
  prisma,
  resolveHandoutHtml,
  BitsHandoutSchemaV1,
} from '@hmp/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@hmp/ui';
import { getSessionUser, requireRole } from '@hmp/auth';
import { StatusBadge } from '@/components/status-badge';
import { StatusTimeline } from '@/components/status-timeline';
import { ApprovalsList } from '@/components/approvals-list';
import { HandoutViewer } from '@/components/handout-viewer';
import { VersionList } from '@/components/version-list';
import { VersionDiff } from '@/components/version-diff';
import { CommentThread } from '@/components/comment-thread';
import { loadHandoutForFaculty, listVersions } from '@/lib/handout-versioning';
import { QualityReportCard } from '@/components/quality-report-card';
import { AcceptPanel } from './accept-panel';
import { StartEditingPanel } from './start-editing-panel';
import { EditorPanel } from './editor-panel';
import { QualityPanel } from './quality-panel';
import { StructuredEditor } from './structured-editor/StructuredEditor';
import { ConvertBanner } from './structured-editor/ConvertBanner';

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

type AutoFetchedTier = 'prior-version' | 'import' | 'empty';
const AUTO_FETCHED_TIERS: ReadonlyArray<AutoFetchedTier> = ['prior-version', 'import', 'empty'];

function parseAutoFetchSearchParams(
  searchParams: Record<string, string | string[] | undefined> | undefined,
): { tier: AutoFetchedTier; detail: string } | undefined {
  if (!searchParams) return undefined;
  const tierRaw = searchParams.autoFetched;
  const detailRaw = searchParams.detail;
  const tier = Array.isArray(tierRaw) ? tierRaw[0] : tierRaw;
  const detail = Array.isArray(detailRaw) ? detailRaw[0] : detailRaw;
  if (!tier || !detail) return undefined;
  if (!AUTO_FETCHED_TIERS.includes(tier as AutoFetchedTier)) return undefined;
  return { tier: tier as AutoFetchedTier, detail };
}

export default async function FacultyAssignmentDetail({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
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

  // Revert banner (Prompt 12-b). When the handout is back with faculty for
  // rework, the most recent Approval row is the revert that produced it. Its
  // `stage` distinguishes who sent it back: SME_REVIEW = the assigned SME,
  // PC_REVIEW = the Programme Committee. Surfaces the reason up top so faculty
  // don't have to scroll to the comment thread to learn why.
  const revert =
    status === HandoutStatus.REWORK_REQUESTED
      ? await prisma.approval.findFirst({
          where: { requestId: request.id, decision: ApprovalDecision.REWORK },
          orderBy: { createdAt: 'desc' },
          select: {
            stage: true,
            comments: true,
            reviewer: { select: { name: true } },
          },
        })
      : null;
  const revertFromSme = revert?.stage === ApprovalStage.SME_REVIEW;

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

      {revert && (
        <Card
          data-testid={revertFromSme ? 'revert-banner-sme' : 'revert-banner-pc'}
          style={{ borderColor: 'var(--warn)' }}
        >
          <CardHeader>
            <CardTitle className="text-base">
              {revertFromSme
                ? 'Your SME requested changes'
                : 'The Programme Committee requested changes'}
            </CardTitle>
            <CardDescription>
              Sent back by {revert.reviewer.name}. Address the feedback below and resubmit.
            </CardDescription>
          </CardHeader>
          {revert.comments && (
            <CardContent>
              <p className="whitespace-pre-wrap text-sm">{revert.comments}</p>
            </CardContent>
          )}
        </Card>
      )}

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

      {EDITABLE.has(status) && handout && currentVersion && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>
                {status === HandoutStatus.REWORK_REQUESTED
                  ? 'Address rework + resubmit'
                  : 'Edit handout'}
              </CardTitle>
              <CardDescription>
                Each save creates a new version. Submit when ready for SME review.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {(() => {
                // Prompt 11d routing: a HandoutVersion with structured `data`
                // shows the new StructuredEditor; a legacy version (data null)
                // shows the ConvertBanner above the existing TipTap editor.
                const parsed =
                  currentVersion.data != null
                    ? BitsHandoutSchemaV1.safeParse(currentVersion.data)
                    : null;
                if (parsed?.success) {
                  return (
                    <StructuredEditor
                      requestId={request.id}
                      initialData={parsed.data}
                      isRework={status === HandoutStatus.REWORK_REQUESTED}
                      autoFetch={parseAutoFetchSearchParams(searchParams)}
                    />
                  );
                }
                return (
                  <>
                    <ConvertBanner requestId={request.id} />
                    <EditorPanel
                      requestId={request.id}
                      initialJson={currentVersion.contentJson ?? null}
                      isRework={status === HandoutStatus.REWORK_REQUESTED}
                    />
                  </>
                );
              })()}
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

      {handout && (
        <Card>
          <CardHeader>
            <CardTitle id="comment-thread">Discussion</CardTitle>
            <CardDescription>
              Visible to IC, HOG, PC, the assigned faculty, and the assigned SME.
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

import { notFound } from 'next/navigation';
import {
  prisma,
  HandoutStatus,
  FacultyType,
  RoleName,
  ApprovalStage,
  ApprovalDecision,
  resolveHandoutHtml,
  ACTIVE_USER_FILTER,
} from '@hmp/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@hmp/ui';
import { StatusBadge } from '@/components/status-badge';
import { DownloadMenu } from '@/components/download-menu';
import { PRIVILEGED_STATUSES } from '@/lib/export/access';
import { StatusTimeline } from '@/components/status-timeline';
import { ApprovalsList } from '@/components/approvals-list';
import { FacultyAssignmentsList } from '@/components/faculty-assignments-list';
import { HandoutViewer } from '@/components/handout-viewer';
import { VersionList } from '@/components/version-list';
import { VersionDiff } from '@/components/version-diff';
import { CommentThread } from '@/components/comment-thread';
import { AttachmentsPanel } from '@/components/attachments-panel';
import { loadAttachments } from '@/lib/attachments';
import { listFacultyForAllocation } from '@/lib/faculty-load';
import { listVersions } from '@/lib/handout-versioning';
import { recommendFaculty, type RecommendationResult } from '@hmp/ai';
import { QualityReportCard } from '@/components/quality-report-card';
import { AllocationPanel, type FacultyChoice, type SmeChoice } from './allocation-panel';
import { FinalApprovalPanel } from './approval-panel';

// Workflow detail pages MUST be force-dynamic. See ic/requests/[id]/page.tsx
// for the rationale (Next.js production-build RSC caching vs revalidatePath).
export const dynamic = 'force-dynamic';

const CAPPED_TYPES = new Set<FacultyType | null>([
  FacultyType.OFF_CAMPUS,
  FacultyType.ADJUNCT,
  FacultyType.GUEST,
]);

export default async function HOGRequestDetail({ params }: { params: { id: string } }) {
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

  const cap =
    (await prisma.workflowConfig.findUnique({ where: { key: 'default' } }))?.offCampusMaxCourses ??
    3;

  let facultyChoices: FacultyChoice[] = [];
  let smeChoices: SmeChoice[] = [];
  let recommendation: RecommendationResult | null = null;
  // Prompt 22: if a prior allocation was rejected by PC, surface the reason so
  // HOG re-allocates informed. The reject writes a PC_REVIEW/REWORK Approval.
  let allocationRejectReason: string | null = null;
  if (request.status === HandoutStatus.REQUESTED) {
    const lastReject = await prisma.approval.findFirst({
      where: {
        requestId: request.id,
        stage: ApprovalStage.PC_REVIEW,
        decision: ApprovalDecision.REWORK,
        comments: { not: null },
      },
      orderBy: { decidedAt: 'desc' },
      select: { comments: true },
    });
    allocationRejectReason = lastReject?.comments ?? null;
  }
  if (request.status === HandoutStatus.REQUESTED) {
    const [list, smeUsers] = await Promise.all([
      listFacultyForAllocation(request.offering.semesterId),
      // Prompt 12-b: HOG designates the (mandatory) SME at allocation.
      prisma.user.findMany({
        where: { ...ACTIVE_USER_FILTER, roles: { some: { role: { name: RoleName.SME } } } },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, email: true },
      }),
    ]);
    facultyChoices = list.map((f) => ({
      id: f.id,
      name: f.name,
      email: f.email,
      facultyType: f.facultyType,
      loadInSemester: f.loadInSemester,
      capped: CAPPED_TYPES.has(f.facultyType) && f.loadInSemester >= cap,
    }));
    smeChoices = smeUsers;
    try {
      recommendation = await recommendFaculty({ requestId: request.id });
    } catch {
      recommendation = null;
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
            <p className="text-muted-foreground mt-1 text-xs">
              {request.offering.semester.programme.code} · {request.offering.semester.name} ·{' '}
              initiated by {request.initiator.name}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={request.status} />
            {PRIVILEGED_STATUSES.includes(request.status) && (
              <DownloadMenu requestId={request.id} />
            )}
          </div>
        </CardHeader>
      </Card>

      {request.status === HandoutStatus.REQUESTED && allocationRejectReason && (
        <Card className="border-amber-300 bg-amber-50">
          <CardHeader>
            <CardTitle className="text-amber-800">Previous allocation rejected by PC</CardTitle>
            <CardDescription className="text-amber-700">
              Re-allocate addressing this feedback: “{allocationRejectReason}”
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {request.status === HandoutStatus.REQUESTED && (
        <Card>
          <CardHeader>
            <CardTitle>Allocate faculty</CardTitle>
            <CardDescription>Off-campus / adjunct cap: {cap} courses per semester.</CardDescription>
          </CardHeader>
          <CardContent>
            <AllocationPanel
              requestId={request.id}
              faculties={facultyChoices}
              smes={smeChoices}
              cap={cap}
              recommendation={recommendation}
            />
          </CardContent>
        </Card>
      )}

      {request.status === HandoutStatus.UNDER_REVIEW && (
        <Card>
          <CardHeader>
            <CardTitle>Final approval</CardTitle>
            <CardDescription>PC has signed off. Approve, rework, or reject.</CardDescription>
          </CardHeader>
          <CardContent>
            <FinalApprovalPanel requestId={request.id} />
          </CardContent>
        </Card>
      )}

      {handout && handout.currentVersion && (
        <Card>
          <CardHeader>
            <CardTitle>Handout (v{handout.currentVersion.versionNo})</CardTitle>
            <CardDescription>Latest version for final review.</CardDescription>
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

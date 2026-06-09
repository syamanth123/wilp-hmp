import {
  prisma,
  HandoutStatus,
  ApprovalStage,
  ApprovalDecision,
  FacultyType,
  type Prisma,
} from '@hmp/db';

/**
 * Sentinel year prefixes reserved for E2E + integration test fixtures.
 *
 * Real handout refNos use the current calendar year (`HMP-YYYY-####`). Tests
 * use a year far in the future so that:
 *   - cleanup-by-prefix can't ever stomp on a real handout row;
 *   - real refNo generation can't ever collide with a fixture row;
 *   - on inspection (Prisma Studio, audit logs) it's obvious which rows are
 *     test artifacts.
 *
 * Allocation:
 *   8888 — m6 publish/archive fixtures (this file)
 *   9999 — concurrent.test.ts integration test
 *
 * Add a comment + table row here when claiming a new sentinel year.
 */
export const SENTINEL_YEARS = {
  M6_FIXTURE: 8888,
  CONCURRENT_TEST: 9999,
} as const;

const FIXTURE_REF_PREFIX = `HMP-${SENTINEL_YEARS.M6_FIXTURE}-`;
const FIXTURE_TEMPLATE_NAME = 'Standard Handout';

const DEFAULT_CONTENT_JSON: Prisma.InputJsonValue = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Course Handout' }] },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Part A — Course Description' }],
    },
    { type: 'paragraph', content: [{ type: 'text', text: 'Fixture content for E2E.' }] },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Part B — Course Plan' }],
    },
    { type: 'paragraph' },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Evaluative Components' }],
    },
    { type: 'paragraph' },
  ],
};

const DEFAULT_CONTENT_HTML =
  '<h1>Course Handout</h1>' +
  '<h2>Part A — Course Description</h2><p>Fixture content for E2E.</p>' +
  '<h2>Part B — Course Plan</h2><p></p>' +
  '<h2>Evaluative Components</h2><p></p>';

const TAXILA_STUB_RESPONSE = {
  provider: 'taxila-stub',
  fixture: true,
  bytes: DEFAULT_CONTENT_HTML.length,
  simulatedAt: '2026-01-01T00:00:00.000Z',
};

export interface SeedHandoutOptions {
  /** Target status. Each adds the upstream approval rows that would
   *  realistically exist for a real request at that point in the workflow.
   *  IN_PROGRESS is identical to ASSIGNED in seeded shape — faculty has started
   *  editing (the fixture already always creates an initial HandoutVersion) so
   *  comments are available. SME_REVIEW additionally creates the SmeAssignment
   *  (Prompt 12-b) so the handout sits in the assigned SME's approval queue. */
  status: 'ASSIGNED' | 'IN_PROGRESS' | 'SME_REVIEW' | 'APPROVED' | 'PUBLISHED';
  /** IC user email (defaults to the seeded `ic@hmp.local`). */
  initiatorEmail?: string;
  /** Faculty user email (defaults to the seeded `faculty@hmp.local`). */
  facultyEmail?: string;
  /** HOG user email for HOG_REVIEW + HOG_FINAL approvals. */
  hogEmail?: string;
  /** PC user email for PC_REVIEW approval. */
  pcEmail?: string;
  /** SME user email (Prompt 12-b). Required in practice for SME_REVIEW — the
   *  SmeAssignment is created when this is set (defaults to `sme@hmp.local`
   *  whenever status is SME_REVIEW so the queue/detail pages resolve an SME). */
  smeEmail?: string;
}

export interface SeededHandout {
  requestId: string;
  handoutId: string;
  refNo: string;
}

/**
 * Builds a fully-populated HandoutRequest at the target status by writing all
 * rows directly via Prisma. Bypasses the workflow `transition()` orchestrator
 * on purpose — the workflow contract is already covered by m3/m4/m5 E2E specs;
 * this fixture exists for setup speed and isolation in m6.
 *
 * What gets created (varies by status — each row reflects what would
 * realistically exist for a real request at that workflow point):
 *   HandoutRequest               (status: opts.status, refNo: HMP-8888-...)
 *   └── Handout                  (status: opts.status)
 *       └── HandoutVersion v1    (content + html — always created for fixture
 *                                 simplicity, even for ASSIGNED where real
 *                                 requests wouldn't have one yet)
 *   FacultyAssignment            (acceptedAt set)
 *   SmeAssignment                — SME_REVIEW (or when smeEmail is passed)
 *   Approval HOG_REVIEW APPROVED — always (HOG allocated)
 *   Approval PC_REVIEW  APPROVED — always (PC confirmed)
 *   Approval HOG_FINAL  APPROVED — APPROVED + PUBLISHED only
 *   Approval IC_PUBLISH APPROVED — PUBLISHED only
 *   LmsPublishLog success         — PUBLISHED only
 *
 * The refNo is constructed with a monotonic suffix (process.hrtime + random)
 * so concurrent beforeEach calls cannot collide on the @unique constraint.
 */
export async function seedHandoutAtStatus(opts: SeedHandoutOptions): Promise<SeededHandout> {
  const initiatorEmail = opts.initiatorEmail ?? 'ic@hmp.local';
  const facultyEmail = opts.facultyEmail ?? 'faculty@hmp.local';
  const hogEmail = opts.hogEmail ?? 'hog@hmp.local';
  const pcEmail = opts.pcEmail ?? 'pc@hmp.local';

  // SME assignment is created for SME_REVIEW (defaulting the email) or whenever
  // an smeEmail is explicitly passed.
  const smeEmail = opts.smeEmail ?? (opts.status === 'SME_REVIEW' ? 'sme@hmp.local' : undefined);

  const [ic, faculty, hog, pc, sme] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { email: initiatorEmail } }),
    prisma.user.findUniqueOrThrow({ where: { email: facultyEmail } }),
    prisma.user.findUniqueOrThrow({ where: { email: hogEmail } }),
    prisma.user.findUniqueOrThrow({ where: { email: pcEmail } }),
    smeEmail
      ? prisma.user.findUniqueOrThrow({ where: { email: smeEmail } })
      : Promise.resolve(null),
  ]);

  const offering = await prisma.courseOffering.findFirst({
    orderBy: { createdAt: 'asc' },
  });
  if (!offering) {
    throw new Error('seedHandoutAtStatus: no CourseOffering — run `pnpm db:seed` first.');
  }

  const template = await prisma.template.findUnique({
    where: { name: FIXTURE_TEMPLATE_NAME },
  });

  const refNo = `${FIXTURE_REF_PREFIX}${process.hrtime.bigint().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;

  const status =
    opts.status === 'PUBLISHED'
      ? HandoutStatus.PUBLISHED
      : opts.status === 'APPROVED'
        ? HandoutStatus.APPROVED
        : opts.status === 'SME_REVIEW'
          ? HandoutStatus.SME_REVIEW
          : opts.status === 'IN_PROGRESS'
            ? HandoutStatus.IN_PROGRESS
            : HandoutStatus.ASSIGNED;
  const facultyType = faculty.facultyType ?? FacultyType.ON_CAMPUS;
  const now = new Date();

  // One transaction so a fixture either lands fully or not at all.
  const created = await prisma.$transaction(async (tx) => {
    const request = await tx.handoutRequest.create({
      data: {
        refNo,
        courseOfferingId: offering.id,
        initiatedById: ic.id,
        status,
        notes: 'E2E fixture (seedHandoutAtStatus)',
      },
    });

    // Handout + initial HandoutVersion. currentVersionId is set after the
    // version row exists so the FK resolves cleanly.
    const handoutShell = await tx.handout.create({
      data: {
        requestId: request.id,
        status,
        templateId: template?.id ?? null,
      },
    });
    const version = await tx.handoutVersion.create({
      data: {
        handoutId: handoutShell.id,
        versionNo: 1,
        contentJson: DEFAULT_CONTENT_JSON,
        contentHtml: DEFAULT_CONTENT_HTML,
        authorId: faculty.id,
        notes: 'Fixture initial version.',
      },
    });
    await tx.handout.update({
      where: { id: handoutShell.id },
      data: { currentVersionId: version.id },
    });

    await tx.facultyAssignment.create({
      data: {
        requestId: request.id,
        facultyId: faculty.id,
        facultyType,
        active: true,
        acceptedAt: now,
      },
    });

    // SmeAssignment (Prompt 12-b) — the designated SME for this handout. The
    // HOG assigns it at allocation; the fixture stands in for that step.
    if (sme) {
      await tx.smeAssignment.create({
        data: {
          requestId: request.id,
          smeUserId: sme.id,
          assignedById: hog.id,
        },
      });
    }

    // Upstream approvals — HOG_REVIEW + PC_REVIEW always present (true
    // from ASSIGNED onwards). HOG_FINAL only after the review cycle,
    // so APPROVED + PUBLISHED only. Explicitly typed so the conditional
    // HOG_FINAL push below doesn't fight the array's inferred literal type.
    const approvals: Prisma.ApprovalCreateManyInput[] = [
      {
        requestId: request.id,
        stage: ApprovalStage.HOG_REVIEW,
        decision: ApprovalDecision.APPROVED,
        reviewerId: hog.id,
        decidedAt: now,
      },
      {
        requestId: request.id,
        stage: ApprovalStage.PC_REVIEW,
        decision: ApprovalDecision.APPROVED,
        reviewerId: pc.id,
        decidedAt: now,
      },
    ];
    if (opts.status === 'APPROVED' || opts.status === 'PUBLISHED') {
      approvals.push({
        requestId: request.id,
        stage: ApprovalStage.HOG_FINAL,
        decision: ApprovalDecision.APPROVED,
        reviewerId: hog.id,
        decidedAt: now,
      });
    }
    await tx.approval.createMany({ data: approvals });

    if (opts.status === 'PUBLISHED') {
      await tx.approval.create({
        data: {
          requestId: request.id,
          stage: ApprovalStage.IC_PUBLISH,
          decision: ApprovalDecision.APPROVED,
          reviewerId: ic.id,
          decidedAt: now,
        },
      });
      await tx.lmsPublishLog.create({
        data: {
          handoutId: handoutShell.id,
          status: 'success',
          responseJson: TAXILA_STUB_RESPONSE,
        },
      });
    }

    return { requestId: request.id, handoutId: handoutShell.id, refNo: request.refNo };
  });

  return created;
}

/**
 * Removes every fixture-created HandoutRequest by refNo prefix. Safe to call
 * unconditionally — won't touch real data because real refNos never use
 * `HMP-8888-`. Cascades delete Handout, HandoutVersion, FacultyAssignment,
 * Approval, LmsPublishLog, AIDraftLog, AIQualityReport, AIRecommendation,
 * Comment, Attachment, AuditLog (via schema onDelete: Cascade).
 */
export async function cleanupTestHandouts(): Promise<void> {
  await prisma.handoutRequest.deleteMany({
    where: { refNo: { startsWith: FIXTURE_REF_PREFIX } },
  });
}

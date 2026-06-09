import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { PrismaClient, HandoutStatus, ApprovalStage, ApprovalDecision, RoleName } from '@hmp/db';
import { smeApprove, smeRevert, SmeReviewError } from '../sme-review';
import { WorkflowError } from '@hmp/workflow';

/**
 * Integration test for the Prompt 12-a SME approval helpers. Drives the real
 * `transition()` (which opens its own $transaction against the global prisma
 * client), so it needs a reachable Postgres + a seeded CourseOffering. Probe-
 * skips otherwise — same convention as corpus-import-action.test.ts.
 *
 * Each test builds a minimal request graph at SME_REVIEW (request + handout +
 * SmeAssignment) with a unique refNo, exercises a helper, asserts the status
 * transition + the Approval / Comment side-effects, then cleans up.
 */

const prisma = new PrismaClient();

let dbReady = false;
let offeringId: string | null = null;
let smeUserId: string | null = null;
let otherSmeUserId: string | null = null;
let facultyUserId: string | null = null;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const offering = await prisma.courseOffering.findFirst({ select: { id: true } });
    const sme = await prisma.user.findFirst({
      where: { roles: { some: { role: { name: RoleName.SME } } } },
      select: { id: true },
    });
    const faculty = await prisma.user.findFirst({
      where: { roles: { some: { role: { name: RoleName.FACULTY } } } },
      select: { id: true },
    });
    // A second user to stand in as a "different SME" for the ownership test.
    // Any user id distinct from the assigned SME works (the helper compares
    // SmeAssignment.smeUserId to the actor id; role is supplied by the actor).
    const other = await prisma.user.findFirst({
      where: { id: { not: sme?.id ?? '' } },
      select: { id: true },
    });
    offeringId = offering?.id ?? null;
    smeUserId = sme?.id ?? null;
    facultyUserId = faculty?.id ?? null;
    otherSmeUserId = other?.id ?? null;
    dbReady = Boolean(offeringId && smeUserId && facultyUserId && otherSmeUserId);
  } catch {
    dbReady = false;
  }
  if (!dbReady) {
    console.warn('[sme-review.test] Postgres unreachable or unseeded — probe-skipping.');
  }
});

const PREFIX = `SME-TEST-${process.pid}-${Date.now()}`;
const createdRequestIds: string[] = [];

/** Build a request graph parked at the given status, with an SmeAssignment. */
async function seedAtSmeReview(opts: { assignedSme: string }): Promise<string> {
  const n = createdRequestIds.length + 1;
  const request = await prisma.handoutRequest.create({
    data: {
      refNo: `${PREFIX}-${n}`,
      courseOfferingId: offeringId!,
      initiatedById: facultyUserId!,
      status: HandoutStatus.SME_REVIEW,
      handout: { create: { status: HandoutStatus.SME_REVIEW } },
      smeAssignment: { create: { smeUserId: opts.assignedSme, assignedById: facultyUserId! } },
    },
    select: { id: true },
  });
  createdRequestIds.push(request.id);
  return request.id;
}

afterEach(async () => {
  if (!dbReady) return;
  // Cascades to Handout, SmeAssignment, Approval, Comment, AuditLog via FK
  // onDelete rules where present; explicit cleanups for the rest.
  for (const id of createdRequestIds) {
    await prisma.approval.deleteMany({ where: { requestId: id } });
    await prisma.auditLog.deleteMany({ where: { requestId: id } });
    await prisma.handoutRequest.delete({ where: { id } }).catch(() => {});
  }
  createdRequestIds.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

const integ = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!dbReady) return;
    await fn();
  });

describe('smeApprove (Prompt 12-a)', () => {
  integ(
    'transitions SME_REVIEW → SUBMITTED and writes an SME_REVIEW Approval(APPROVED)',
    async () => {
      const requestId = await seedAtSmeReview({ assignedSme: smeUserId! });
      await smeApprove(requestId, { id: smeUserId!, roles: [RoleName.SME] });

      const after = await prisma.handoutRequest.findUnique({
        where: { id: requestId },
        select: { status: true },
      });
      expect(after?.status).toBe(HandoutStatus.SUBMITTED);

      const approval = await prisma.approval.findFirst({
        where: { requestId, stage: ApprovalStage.SME_REVIEW },
      });
      expect(approval?.decision).toBe(ApprovalDecision.APPROVED);
      expect(approval?.reviewerId).toBe(smeUserId);
    },
  );

  integ('rejects approval from a user who is not the assigned SME', async () => {
    const requestId = await seedAtSmeReview({ assignedSme: smeUserId! });
    await expect(
      smeApprove(requestId, { id: otherSmeUserId!, roles: [RoleName.SME] }),
    ).rejects.toBeInstanceOf(SmeReviewError);
    // Status unchanged (effect threw → whole transition rolled back).
    const after = await prisma.handoutRequest.findUnique({
      where: { id: requestId },
      select: { status: true },
    });
    expect(after?.status).toBe(HandoutStatus.SME_REVIEW);
  });
});

describe('smeRevert (Prompt 12-a)', () => {
  integ(
    'transitions SME_REVIEW → REWORK_REQUESTED and writes Approval(REWORK) + a Comment',
    async () => {
      const requestId = await seedAtSmeReview({ assignedSme: smeUserId! });
      await smeRevert(
        requestId,
        { id: smeUserId!, roles: [RoleName.SME] },
        'Please cite the 2024 standard.',
      );

      const after = await prisma.handoutRequest.findUnique({
        where: { id: requestId },
        select: { status: true, handout: { select: { id: true } } },
      });
      expect(after?.status).toBe(HandoutStatus.REWORK_REQUESTED);

      const approval = await prisma.approval.findFirst({
        where: { requestId, stage: ApprovalStage.SME_REVIEW },
      });
      expect(approval?.decision).toBe(ApprovalDecision.REWORK);
      expect(approval?.comments).toContain('2024 standard');

      const comment = await prisma.comment.findFirst({
        where: { handoutId: after!.handout!.id, authorId: smeUserId! },
      });
      expect(comment?.body).toContain('2024 standard');
    },
  );

  integ('requires a non-empty comment', async () => {
    const requestId = await seedAtSmeReview({ assignedSme: smeUserId! });
    await expect(
      smeRevert(requestId, { id: smeUserId!, roles: [RoleName.SME] }, '   '),
    ).rejects.toBeInstanceOf(SmeReviewError);
    const after = await prisma.handoutRequest.findUnique({
      where: { id: requestId },
      select: { status: true },
    });
    expect(after?.status).toBe(HandoutStatus.SME_REVIEW);
  });
});

describe('SME helpers — invalid status (Prompt 12-a)', () => {
  integ(
    'rejects approve from a non-SME_REVIEW status (WorkflowError invalid_transition)',
    async () => {
      // Park a request at IN_PROGRESS with an SmeAssignment, then try to approve.
      const n = createdRequestIds.length + 1;
      const request = await prisma.handoutRequest.create({
        data: {
          refNo: `${PREFIX}-bad-${n}`,
          courseOfferingId: offeringId!,
          initiatedById: facultyUserId!,
          status: HandoutStatus.IN_PROGRESS,
          handout: { create: { status: HandoutStatus.IN_PROGRESS } },
          smeAssignment: { create: { smeUserId: smeUserId!, assignedById: facultyUserId! } },
        },
        select: { id: true },
      });
      createdRequestIds.push(request.id);
      await expect(
        smeApprove(request.id, { id: smeUserId!, roles: [RoleName.SME] }),
      ).rejects.toBeInstanceOf(WorkflowError);
    },
  );
});

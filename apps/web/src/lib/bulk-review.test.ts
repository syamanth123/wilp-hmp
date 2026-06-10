import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { PrismaClient, HandoutStatus, ApprovalStage, ApprovalDecision, RoleName } from '@hmp/db';
import { bulkReview, type BulkActor } from './bulk-review';
import { PC_CONFIG } from '@/app/pc/bulk-review/config';
import { SME_CONFIG } from '@/app/sme/bulk-review/config';
import { HOG_CONFIG } from '@/app/hog/bulk-review/config';

/**
 * Integration test for the Prompt 15 bulk review pipeline. Drives the real
 * per-row `transition()` (PC/HOG inline effects, SME via smeApprove/smeRevert
 * helpers) against Postgres. Probe-skips if the DB is unreachable.
 *
 * Each test mints requests directly at the target status, runs bulkReview with
 * the real role config, asserts, and tears down in afterEach.
 */

const prisma = new PrismaClient();
const TAG = `BULKREV-${process.pid}-${Date.now()}`;

let dbReady = false;
let icId = '';
let pc: BulkActor;
let sme: BulkActor;
let smeUserId = '';
let otherSmeUserId = '';
let hog: BulkActor;

const ids: { prog?: string; sem?: string } = {};
const courseIds: string[] = [];
const offeringIds: string[] = [];
const requestIds: string[] = [];
let seq = 0;

async function mkRequest(
  status: HandoutStatus,
  opts: { assignedSme?: string } = {},
): Promise<{ id: string; refNo: string; handoutId: string }> {
  seq += 1;
  const course = await prisma.course.create({
    data: { bitsCourseNumber: `BR ZG${700 + seq}`, code: `${TAG}-${seq}`, title: `${TAG} ${seq}` },
  });
  courseIds.push(course.id);
  const off = await prisma.courseOffering.create({
    data: { courseId: course.id, semesterId: ids.sem! },
  });
  offeringIds.push(off.id);
  const req = await prisma.handoutRequest.create({
    data: {
      refNo: `${TAG}-R${seq}`,
      courseOfferingId: off.id,
      initiatedById: icId,
      status,
      handout: { create: { status } },
      ...(opts.assignedSme
        ? { smeAssignment: { create: { smeUserId: opts.assignedSme, assignedById: icId } } }
        : {}),
    },
    select: { id: true, refNo: true, handout: { select: { id: true } } },
  });
  requestIds.push(req.id);
  return { id: req.id, refNo: req.refNo, handoutId: req.handout!.id };
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const byRole = (r: RoleName) =>
      prisma.user.findFirstOrThrow({
        where: { roles: { some: { role: { name: r } } } },
        select: { id: true, name: true },
      });
    const [ic, pcU, smeU, hogU] = await Promise.all([
      prisma.user.findFirstOrThrow({
        where: { roles: { some: { role: { name: RoleName.INSTRUCTION_CELL } } } },
        select: { id: true },
      }),
      byRole(RoleName.PROGRAMME_COMMITTEE),
      prisma.user.findUniqueOrThrow({
        where: { email: 'sme@hmp.local' },
        select: { id: true, name: true },
      }),
      byRole(RoleName.HOG),
    ]);
    icId = ic.id;
    pc = { id: pcU.id, name: pcU.name, roles: [RoleName.PROGRAMME_COMMITTEE] };
    sme = { id: smeU.id, name: smeU.name, roles: [RoleName.SME] };
    smeUserId = smeU.id;
    otherSmeUserId = hogU.id; // any id distinct from the acting SME, for the "not yours" gate
    hog = { id: hogU.id, name: hogU.name, roles: [RoleName.HOG] };

    const prog = await prisma.programme.create({ data: { code: `${TAG}-P`, name: `${TAG}` } });
    const sem = await prisma.semester.create({
      data: {
        programmeId: prog.id,
        name: `${TAG}-Sem`,
        year: 2099,
        term: 'FIRST',
        startDate: new Date('2099-01-01'),
        endDate: new Date('2099-06-01'),
      },
    });
    Object.assign(ids, { prog: prog.id, sem: sem.id });
    dbReady = true;
  } catch (err) {
    dbReady = false;
    console.warn('[bulk-review.test] Postgres unreachable or unseeded — probe-skipping.', err);
  }
});

afterEach(async () => {
  if (!dbReady) return;
  for (const id of requestIds) {
    await prisma.notification.deleteMany({ where: { meta: { path: ['requestId'], equals: id } } });
    await prisma.auditLog.deleteMany({ where: { requestId: id } });
    // HandoutRequest delete cascades Handout → HandoutVersion/Comment, plus Approval / SmeAssignment.
    await prisma.handoutRequest.delete({ where: { id } }).catch(() => {});
  }
  requestIds.length = 0;
  await prisma.courseOffering.deleteMany({ where: { id: { in: offeringIds } } });
  await prisma.course.deleteMany({ where: { id: { in: courseIds } } });
  offeringIds.length = 0;
  courseIds.length = 0;
});

afterAll(async () => {
  if (dbReady) {
    await prisma.semester.deleteMany({ where: { id: ids.sem! } });
    await prisma.programme.deleteMany({ where: { id: ids.prog! } });
  }
  await prisma.$disconnect();
});

const csvOf = (rows: string[]) => ['request_reference,action,comment', ...rows].join('\n');
const statusOf = async (refNo: string) =>
  (await prisma.handoutRequest.findUnique({ where: { refNo }, select: { status: true } }))?.status;

describe('bulkReview — PC', () => {
  it('pc_approve → UNDER_REVIEW + PC_REVIEW/APPROVED', async () => {
    if (!dbReady) return;
    const r = await mkRequest(HandoutStatus.SUBMITTED);
    const res = await bulkReview(PC_CONFIG, csvOf([`${r.refNo},pc_approve,`]), pc);
    expect(res.status).toBe('success');
    expect(await statusOf(r.refNo)).toBe(HandoutStatus.UNDER_REVIEW);
    const ap = await prisma.approval.findFirst({
      where: {
        requestId: r.id,
        stage: ApprovalStage.PC_REVIEW,
        decision: ApprovalDecision.APPROVED,
      },
    });
    expect(ap).not.toBeNull();
  });

  it('pc_rework (with comment) → REWORK_REQUESTED', async () => {
    if (!dbReady) return;
    const r = await mkRequest(HandoutStatus.SUBMITTED);
    const res = await bulkReview(PC_CONFIG, csvOf([`${r.refNo},pc_rework,Tighten the rubric`]), pc);
    expect(res.status).toBe('success');
    expect(await statusOf(r.refNo)).toBe(HandoutStatus.REWORK_REQUESTED);
  });

  it('wrong status (pc_approve on REWORK_REQUESTED) → request_not_in_queue', async () => {
    if (!dbReady) return;
    const r = await mkRequest(HandoutStatus.REWORK_REQUESTED);
    const res = await bulkReview(PC_CONFIG, csvOf([`${r.refNo},pc_approve,`]), pc);
    expect(res.status).toBe('rejected');
    if (res.status === 'rejected') expect(res.errors[0]!.code).toBe('request_not_in_queue');
    expect(await statusOf(r.refNo)).toBe(HandoutStatus.REWORK_REQUESTED); // untouched
  });

  it('pc_rework without comment → comment_required', async () => {
    if (!dbReady) return;
    const r = await mkRequest(HandoutStatus.SUBMITTED);
    const res = await bulkReview(PC_CONFIG, csvOf([`${r.refNo},pc_rework,`]), pc);
    expect(res.status === 'rejected' && res.errors[0]!.code).toBe('comment_required');
  });

  it('invalid action (sme_approve in a PC CSV) → invalid_action', async () => {
    if (!dbReady) return;
    const r = await mkRequest(HandoutStatus.SUBMITTED);
    const res = await bulkReview(PC_CONFIG, csvOf([`${r.refNo},sme_approve,`]), pc);
    expect(res.status === 'rejected' && res.errors[0]!.code).toBe('invalid_action');
  });

  it('no-surprise: one CSV with both PC actions lands each at the right status + shared bulkSessionId', async () => {
    if (!dbReady) return;
    const a = await mkRequest(HandoutStatus.SUBMITTED);
    const b = await mkRequest(HandoutStatus.SUBMITTED);
    const res = await bulkReview(
      PC_CONFIG,
      csvOf([`${a.refNo},pc_approve,`, `${b.refNo},pc_rework,fix`]),
      pc,
    );
    expect(res.status).toBe('success');
    expect(await statusOf(a.refNo)).toBe(HandoutStatus.UNDER_REVIEW);
    expect(await statusOf(b.refNo)).toBe(HandoutStatus.REWORK_REQUESTED);
    const audits = await prisma.auditLog.findMany({
      where: { requestId: { in: [a.id, b.id] }, action: 'pc_review.bulk' },
      select: { after: true },
    });
    expect(audits).toHaveLength(2);
    expect(
      new Set(audits.map((x) => (x.after as { bulkSessionId?: string }).bulkSessionId)).size,
    ).toBe(1);
  });
});

describe('bulkReview — SME', () => {
  it('sme_approve → SUBMITTED', async () => {
    if (!dbReady) return;
    const r = await mkRequest(HandoutStatus.SME_REVIEW, { assignedSme: smeUserId });
    const res = await bulkReview(SME_CONFIG, csvOf([`${r.refNo},sme_approve,`]), sme);
    expect(res.status).toBe('success');
    expect(await statusOf(r.refNo)).toBe(HandoutStatus.SUBMITTED);
  });

  it('sme_revert writes BOTH an Approval(SME_REVIEW,REWORK) AND a Comment-thread row', async () => {
    if (!dbReady) return;
    const r = await mkRequest(HandoutStatus.SME_REVIEW, { assignedSme: smeUserId });
    const res = await bulkReview(
      SME_CONFIG,
      csvOf([`${r.refNo},sme_revert,Please add the rubric`]),
      sme,
    );
    expect(res.status).toBe('success');
    expect(await statusOf(r.refNo)).toBe(HandoutStatus.REWORK_REQUESTED);
    const ap = await prisma.approval.findFirst({
      where: {
        requestId: r.id,
        stage: ApprovalStage.SME_REVIEW,
        decision: ApprovalDecision.REWORK,
      },
    });
    expect(ap, 'Approval(SME_REVIEW, REWORK) must exist').not.toBeNull();
    const comment = await prisma.comment.findFirst({
      where: { handoutId: r.handoutId, authorId: smeUserId },
    });
    expect(comment, 'Comment-thread row must exist (faculty banner feed)').not.toBeNull();
    expect(comment!.body).toContain('Please add the rubric');
  });

  it('not_your_sme_assignment when the request is assigned to a different SME', async () => {
    if (!dbReady) return;
    const r = await mkRequest(HandoutStatus.SME_REVIEW, { assignedSme: otherSmeUserId });
    const res = await bulkReview(SME_CONFIG, csvOf([`${r.refNo},sme_approve,`]), sme);
    expect(res.status === 'rejected' && res.errors[0]!.code).toBe('not_your_sme_assignment');
  });

  it('wrong status (sme_approve on SUBMITTED) → request_not_in_queue', async () => {
    if (!dbReady) return;
    const r = await mkRequest(HandoutStatus.SUBMITTED, { assignedSme: smeUserId });
    const res = await bulkReview(SME_CONFIG, csvOf([`${r.refNo},sme_approve,`]), sme);
    expect(res.status === 'rejected' && res.errors[0]!.code).toBe('request_not_in_queue');
  });
});

describe('bulkReview — HOG', () => {
  it('no-surprise: final_approve / reject / rework each land at the right status', async () => {
    if (!dbReady) return;
    const a = await mkRequest(HandoutStatus.UNDER_REVIEW);
    const b = await mkRequest(HandoutStatus.UNDER_REVIEW);
    const c = await mkRequest(HandoutStatus.UNDER_REVIEW);
    const res = await bulkReview(
      HOG_CONFIG,
      csvOf([
        `${a.refNo},hog_final_approve,`,
        `${b.refNo},hog_reject,Below the bar`,
        `${c.refNo},hog_rework,Revise section 3`,
      ]),
      hog,
    );
    expect(res.status).toBe('success');
    expect(await statusOf(a.refNo)).toBe(HandoutStatus.APPROVED);
    expect(await statusOf(b.refNo)).toBe(HandoutStatus.REJECTED);
    expect(await statusOf(c.refNo)).toBe(HandoutStatus.REWORK_REQUESTED);
    const audits = await prisma.auditLog.findMany({
      where: { requestId: { in: [a.id, b.id, c.id] }, action: 'hog_review.bulk' },
      select: { after: true },
    });
    expect(audits).toHaveLength(3);
    expect(
      new Set(audits.map((x) => (x.after as { bulkSessionId?: string }).bulkSessionId)).size,
    ).toBe(1);
  });

  it('wrong status (hog_final_approve on SUBMITTED) → request_not_in_queue', async () => {
    if (!dbReady) return;
    const r = await mkRequest(HandoutStatus.SUBMITTED);
    const res = await bulkReview(HOG_CONFIG, csvOf([`${r.refNo},hog_final_approve,`]), hog);
    expect(res.status === 'rejected' && res.errors[0]!.code).toBe('request_not_in_queue');
  });

  it('hog_reject without comment → comment_required', async () => {
    if (!dbReady) return;
    const r = await mkRequest(HandoutStatus.UNDER_REVIEW);
    const res = await bulkReview(HOG_CONFIG, csvOf([`${r.refNo},hog_reject,`]), hog);
    expect(res.status === 'rejected' && res.errors[0]!.code).toBe('comment_required');
  });
});

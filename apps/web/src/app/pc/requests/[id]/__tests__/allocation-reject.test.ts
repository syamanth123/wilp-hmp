import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, HandoutStatus, RoleName, ApprovalStage, ApprovalDecision } from '@hmp/db';
import { transition } from '@hmp/workflow';
import { rejectAllocationEffect } from '@/lib/pc-allocation-review';
import { bulkReview } from '@/lib/bulk-review';
import { PC_ALLOCATION_CONFIG } from '@/app/pc/allocation-review/config';
import { notifyTransition } from '@/lib/notifications';

/**
 * Integration test for Prompt 22 PC allocation reject. Drives the real
 * transition() + effect + bulkReview() + notifyTransition() against Postgres
 * (server actions can't run here — no session — so we call the libraries the
 * actions wrap). Probe-skips if the DB is unreachable. Verifies the four
 * watch-items: re-allocate after reject has NO unique violation (the reason
 * SmeAssignment is hard-deleted), the audit chain reconstructs, and the
 * notification recipient set is HOG + faculty (NOT SME).
 */

const prisma = new PrismaClient();
const PREFIX = `ALLOCREJ-${process.pid}-${Date.now()}`;

let ready = false;
let offeringId = '';
let hogId = '';
let pcId = '';
let facultyId = '';
let smeId = '';
let sme2Id = '';
const createdRequestIds: string[] = [];

async function allocate(requestId: string, fId: string, sId: string) {
  await transition({
    requestId,
    event: 'FACULTY_ALLOCATED',
    actor: { id: hogId, roles: [RoleName.HOG] },
    meta: { facultyIds: [fId], smeUserId: sId },
    effects: async (tx) => {
      await tx.facultyAssignment.create({
        data: { requestId, facultyId: fId, facultyType: 'ON_CAMPUS' },
      });
      await tx.smeAssignment.create({ data: { requestId, smeUserId: sId, assignedById: hogId } });
    },
  });
}

async function mkRequest(): Promise<{ id: string; refNo: string }> {
  const refNo = `${PREFIX}-${createdRequestIds.length + 1}`;
  const r = await prisma.handoutRequest.create({
    data: {
      refNo,
      courseOfferingId: offeringId,
      initiatedById: hogId,
      status: HandoutStatus.REQUESTED,
    },
    select: { id: true, refNo: true },
  });
  createdRequestIds.push(r.id);
  return r;
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const off = await prisma.courseOffering.findFirst({ select: { id: true } });
    const byRole = async (role: RoleName) =>
      (
        await prisma.user.findFirst({
          where: { roles: { some: { role: { name: role } } } },
          select: { id: true },
        })
      )?.id ?? '';
    const smes = await prisma.user.findMany({
      where: { roles: { some: { role: { name: RoleName.SME } } } },
      select: { id: true },
      take: 2,
    });
    offeringId = off?.id ?? '';
    hogId = await byRole(RoleName.HOG);
    pcId = await byRole(RoleName.PROGRAMME_COMMITTEE);
    facultyId = await byRole(RoleName.FACULTY);
    smeId = smes[0]?.id ?? '';
    sme2Id = smes[1]?.id ?? smes[0]?.id ?? '';
    ready = Boolean(offeringId && hogId && pcId && facultyId && smeId);
  } catch {
    ready = false;
  }
  if (!ready) console.warn('[allocation-reject.test] Postgres unreachable/unseeded — skipping.');
});

afterAll(async () => {
  if (createdRequestIds.length) {
    for (const id of createdRequestIds) {
      await prisma.notification.deleteMany({
        where: { meta: { path: ['requestId'], equals: id } },
      });
      await prisma.auditLog.deleteMany({ where: { requestId: id } });
      await prisma.handoutRequest.delete({ where: { id } }).catch(() => undefined);
    }
  }
  await prisma.$disconnect();
});

describe('PC allocation reject (integration)', () => {
  it('reject clears assignments (faculty deactivated, SME hard-deleted) + writes PC_REVIEW/REWORK', async () => {
    if (!ready) return;
    const req = await mkRequest();
    await allocate(req.id, facultyId, smeId);

    await transition({
      requestId: req.id,
      event: 'ALLOCATION_REJECTED',
      actor: { id: pcId, roles: [RoleName.PROGRAMME_COMMITTEE] },
      meta: { reason: 'SME lacks expertise' },
      effects: rejectAllocationEffect('SME lacks expertise', pcId),
    });

    const after = await prisma.handoutRequest.findUniqueOrThrow({
      where: { id: req.id },
      select: { status: true },
    });
    expect(after.status).toBe(HandoutStatus.REQUESTED);
    expect(
      await prisma.facultyAssignment.count({ where: { requestId: req.id, active: true } }),
    ).toBe(0);
    expect(await prisma.facultyAssignment.count({ where: { requestId: req.id } })).toBe(1); // soft — row kept
    expect(await prisma.smeAssignment.count({ where: { requestId: req.id } })).toBe(0); // hard-deleted
    const appr = await prisma.approval.findFirst({
      where: {
        requestId: req.id,
        stage: ApprovalStage.PC_REVIEW,
        decision: ApprovalDecision.REWORK,
      },
      select: { comments: true },
    });
    expect(appr?.comments).toBe('SME lacks expertise');
  });

  it('re-allocate after reject has NO unique violation (the reason SME is hard-deleted)', async () => {
    if (!ready) return;
    const req = await mkRequest();
    await allocate(req.id, facultyId, smeId);
    await transition({
      requestId: req.id,
      event: 'ALLOCATION_REJECTED',
      actor: { id: pcId, roles: [RoleName.PROGRAMME_COMMITTEE] },
      effects: rejectAllocationEffect('try a different SME', pcId),
    });
    // Re-allocate with a DIFFERENT SME — must not hit the requestId @unique.
    await expect(allocate(req.id, facultyId, sme2Id)).resolves.toBeUndefined();
    const after = await prisma.handoutRequest.findUniqueOrThrow({
      where: { id: req.id },
      select: { status: true },
    });
    expect(after.status).toBe(HandoutStatus.ALLOCATED);
    expect(await prisma.smeAssignment.count({ where: { requestId: req.id } })).toBe(1);
    expect(
      await prisma.facultyAssignment.count({ where: { requestId: req.id, active: true } }),
    ).toBe(1);
  });

  it('audit chain reconstructs: FACULTY_ALLOCATED(meta.smeUserId) → ALLOCATION_REJECTED → FACULTY_ALLOCATED', async () => {
    if (!ready) return;
    const req = await mkRequest();
    await allocate(req.id, facultyId, smeId);
    await transition({
      requestId: req.id,
      event: 'ALLOCATION_REJECTED',
      actor: { id: pcId, roles: [RoleName.PROGRAMME_COMMITTEE] },
      effects: rejectAllocationEffect('reason', pcId),
    });
    await allocate(req.id, facultyId, sme2Id);

    const audits = await prisma.auditLog.findMany({
      where: { requestId: req.id, action: { startsWith: 'handout.transition.' } },
      orderBy: { createdAt: 'asc' },
      select: { action: true, after: true },
    });
    const actions = audits.map((a) => a.action);
    expect(actions).toEqual([
      'handout.transition.FACULTY_ALLOCATED',
      'handout.transition.ALLOCATION_REJECTED',
      'handout.transition.FACULTY_ALLOCATED',
    ]);
    // The original allocation's SME is recoverable from the audit meta.
    const firstMeta = (audits[0]!.after as { meta?: { smeUserId?: string } }).meta;
    expect(firstMeta?.smeUserId).toBe(smeId);
  });

  it('reject notification reaches HOG + faculty, NOT the SME (matched-pair principle)', async () => {
    if (!ready) return;
    const req = await mkRequest();
    await allocate(req.id, facultyId, smeId);
    await transition({
      requestId: req.id,
      event: 'ALLOCATION_REJECTED',
      actor: { id: pcId, roles: [RoleName.PROGRAMME_COMMITTEE] },
      effects: rejectAllocationEffect('reason', pcId),
    });
    // notifyTransition runs inline (WORKERS_ENABLED unset). Faculty are now
    // soft-deactivated — the ALLOCATION_REJECTED recipient query must still
    // find them (queries all assignments, not just active).
    await notifyTransition({
      requestId: req.id,
      event: 'ALLOCATION_REJECTED',
      actor: { id: pcId, name: 'PC' },
    });
    const notified = await prisma.notification.findMany({
      where: { meta: { path: ['requestId'], equals: req.id } },
      select: { userId: true },
    });
    const ids = new Set(notified.map((n) => n.userId));
    expect(ids.has(hogId)).toBe(true); // HOG owns re-allocation
    expect(ids.has(facultyId)).toBe(true); // faculty was notified at allocation → notified at retraction
    expect(ids.has(smeId)).toBe(false); // SME was NOT notified at allocation → not at reject
  });

  it('bulk: confirm + reject mixed applies atomically; missing reject comment → reject-all', async () => {
    if (!ready) return;
    const a = await mkRequest();
    const b = await mkRequest();
    await allocate(a.id, facultyId, smeId);
    await allocate(b.id, facultyId, smeId);
    const actor = { id: pcId, roles: [RoleName.PROGRAMME_COMMITTEE], name: 'PC' };

    // Missing comment on a reject row → atomic reject-all (nothing applied).
    const bad = `request_reference,action,comment
${a.refNo},pc_confirm_allocation,
${b.refNo},pc_reject_allocation,`;
    const badRes = await bulkReview(PC_ALLOCATION_CONFIG, bad, actor);
    expect(badRes.status).toBe('rejected');
    expect(
      (
        await prisma.handoutRequest.findUniqueOrThrow({
          where: { id: a.id },
          select: { status: true },
        })
      ).status,
    ).toBe(HandoutStatus.ALLOCATED);

    // Valid mixed: confirm a, reject b (with comment).
    const good = `request_reference,action,comment
${a.refNo},pc_confirm_allocation,
${b.refNo},pc_reject_allocation,SME mismatch`;
    const goodRes = await bulkReview(PC_ALLOCATION_CONFIG, good, actor);
    expect(goodRes.status).toBe('success');
    expect(
      (
        await prisma.handoutRequest.findUniqueOrThrow({
          where: { id: a.id },
          select: { status: true },
        })
      ).status,
    ).toBe(HandoutStatus.ASSIGNED);
    expect(
      (
        await prisma.handoutRequest.findUniqueOrThrow({
          where: { id: b.id },
          select: { status: true },
        })
      ).status,
    ).toBe(HandoutStatus.REQUESTED);
  });
});

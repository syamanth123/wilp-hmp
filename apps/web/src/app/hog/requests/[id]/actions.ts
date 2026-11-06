'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  prisma,
  RoleName,
  ApprovalStage,
  ApprovalDecision,
  HandoutStatus,
  ACTIVE_USER_FILTER,
} from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { assertRequestInScope } from '@/lib/request-scope';
import { changeHogOrPc } from '@/lib/request-handover';
import { transition, WorkflowError, assertOffCampusCap, movedOnMessage } from '@hmp/workflow';
import { notifyTransition } from '@/lib/notifications';
import { audit } from '@/lib/audit';
import { clearTodayRecommendations, recommendFaculty } from '@hmp/ai';
import { AI_OFF_MESSAGE, aiFeaturesEnabled } from '@/lib/features';
import { formError } from '@/lib/form-error';

const allocateSchema = z.object({
  requestId: z.string().cuid(),
  facultyIds: z.array(z.string().cuid()).min(1, 'Pick at least one faculty'),
  // Prompt 12-b: REQUIRED. The SME is the approval gate between faculty submit
  // and PC review, so allocation must designate one. The SmeAssignment is
  // created in the same allocate transaction, and the faculty's later submit
  // routes to SME_REVIEW unconditionally. (12-a introduced this as optional to
  // keep the additive PR green; 12-b flips it once the picker UI is in place.)
  smeUserId: z
    .string({ required_error: 'Choose a subject expert.' })
    .cuid('Select a Subject Matter Expert'),
  // v1.4 §C: the PC member who confirms (optional only while no PC accounts exist).
  pcUserId: z.string().cuid().optional(),
});

const approvalSchema = z.object({
  requestId: z.string().cuid(),
  comments: z.string().max(2000).optional().default(''),
});

const reworkSchema = approvalSchema.extend({
  comments: z.string().min(3, 'Rework requires a comment'),
});

function revalidate(requestId: string) {
  revalidatePath(`/hog/requests/${requestId}`);
  revalidatePath('/hog/requests');
  revalidatePath('/hog');
  revalidatePath(`/ic/requests/${requestId}`);
  revalidatePath(`/pc/requests/${requestId}`);
}

export async function allocateFacultyAction(formData: FormData) {
  const actor = requireRole(await getSessionUser(), RoleName.HOG);
  // v1.4.1: only requests in their department (lib/department-scope.ts).
  await assertRequestInScope(actor, formData.get('requestId'));
  const facultyIds = formData.getAll('facultyIds').map(String).filter(Boolean);
  const smeUserId = String(formData.get('smeUserId') ?? '').trim() || undefined;
  const pcUserId = String(formData.get('pcUserId') ?? '').trim() || undefined;
  const parsed = allocateSchema.safeParse({
    requestId: formData.get('requestId'),
    facultyIds,
    smeUserId,
    pcUserId,
  });
  if (!parsed.success) return { error: formError(parsed.error) };

  const request = await prisma.handoutRequest.findUnique({
    where: { id: parsed.data.requestId },
    include: { offering: true },
  });
  if (!request) return { error: 'This request no longer exists. Refresh the page.' };
  if (request.status !== HandoutStatus.REQUESTED) {
    return { error: movedOnMessage(request.status) };
  }

  const cap =
    (await prisma.workflowConfig.findUnique({ where: { key: 'default' } }))?.offCampusMaxCourses ??
    3;

  const faculties = await prisma.user.findMany({
    where: { id: { in: parsed.data.facultyIds }, ...ACTIVE_USER_FILTER },
    select: { id: true, facultyType: true, name: true },
  });
  if (faculties.length !== parsed.data.facultyIds.length) {
    return {
      error: "One of the chosen faculty can't be allocated. Refresh the page and choose again.",
    };
  }

  // Prompt 12-b: validate the (mandatory) SME — must be active + hold the SME
  // role. The SmeAssignment row is created inside the allocate transaction
  // below so faculty + SME assignment land atomically.
  const sme = await prisma.user.findFirst({
    where: {
      id: parsed.data.smeUserId,
      ...ACTIVE_USER_FILTER,
      roles: { some: { role: { name: RoleName.SME } } },
    },
    select: { id: true },
  });
  if (!sme) {
    return {
      error: "The chosen subject expert can't review handouts any more. Choose another one.",
    };
  }

  // v1.4 §C: the chosen PC must be an active PC; one is required once any PC account exists.
  const pcWhere = {
    ...ACTIVE_USER_FILTER,
    roles: { some: { role: { name: RoleName.PROGRAMME_COMMITTEE } } },
  };
  if (parsed.data.pcUserId) {
    const pc = await prisma.user.findFirst({
      where: { id: parsed.data.pcUserId, ...pcWhere },
      select: { id: true },
    });
    if (!pc) {
      return {
        error: "The chosen PC member can't confirm allocations any more. Choose another one.",
      };
    }
  } else if (await prisma.user.count({ where: pcWhere })) {
    return { error: 'Choose the Programme Committee member who confirms it.' };
  }

  try {
    await transition({
      requestId: request.id,
      event: 'FACULTY_ALLOCATED',
      actor: { id: actor.id, roles: actor.roles },
      meta: { facultyIds: parsed.data.facultyIds, smeUserId: parsed.data.smeUserId },
      effects: async (tx) => {
        // Per-faculty off-campus / adjunct cap check, inside the txn so
        // concurrent allocations cannot both squeak past the limit.
        for (const f of faculties) {
          const load = await tx.facultyAssignment.count({
            where: {
              facultyId: f.id,
              active: true,
              request: { offering: { semesterId: request.offering.semesterId } },
            },
          });
          try {
            assertOffCampusCap(
              { facultyType: f.facultyType, activeAssignmentsInSemester: load },
              cap,
            );
          } catch (err) {
            if (err instanceof WorkflowError) {
              throw new WorkflowError(err.code, `${f.name}: ${err.message}`);
            }
            throw err;
          }

          await tx.facultyAssignment.create({
            data: {
              requestId: request.id,
              facultyId: f.id,
              facultyType: f.facultyType ?? 'ON_CAMPUS',
            },
          });
        }
        await tx.approval.create({
          data: {
            requestId: request.id,
            stage: ApprovalStage.HOG_REVIEW,
            decision: ApprovalDecision.APPROVED,
            reviewerId: actor.id,
            decidedAt: new Date(),
          },
        });
        // Prompt 12-b: create the SmeAssignment in the same transaction.
        // One SME per handout (requestId @unique).
        await tx.smeAssignment.create({
          data: {
            requestId: request.id,
            smeUserId: parsed.data.smeUserId,
            assignedById: actor.id,
          },
        });
        // v1.4 §C: record who is responsible now — the faculty, SME and PC (a re-allocation after a
        // PC rejection ends the previous ones). The HOG row was written when the IC created it.
        await tx.requestAssignee.updateMany({
          where: {
            requestId: request.id,
            endedAt: null,
            role: { in: [RoleName.FACULTY, RoleName.SME, RoleName.PROGRAMME_COMMITTEE] },
          },
          data: { endedAt: new Date(), reason: 'Re-allocated' },
        });
        const assignee = (role: RoleName, userId: string) => ({
          requestId: request.id,
          role,
          userId,
          assignedById: actor.id,
        });
        await tx.requestAssignee.createMany({
          data: [
            ...faculties.map((f) => assignee(RoleName.FACULTY, f.id)),
            assignee(RoleName.SME, parsed.data.smeUserId),
            ...(parsed.data.pcUserId
              ? [assignee(RoleName.PROGRAMME_COMMITTEE, parsed.data.pcUserId)]
              : []),
          ],
        });
      },
    });
  } catch (err) {
    if (err instanceof WorkflowError) return { error: err.message };
    throw err;
  }

  await notifyTransition({
    requestId: request.id,
    event: 'FACULTY_ALLOCATED',
    actor: { id: actor.id, name: actor.name },
  });

  revalidate(request.id);
  return { ok: true };
}

export async function finalApproveAction(formData: FormData) {
  const actor = requireRole(await getSessionUser(), RoleName.HOG);
  // v1.4.1: only requests in their department (lib/department-scope.ts).
  await assertRequestInScope(actor, formData.get('requestId'));
  const parsed = approvalSchema.safeParse({
    requestId: formData.get('requestId'),
    comments: formData.get('comments') ?? '',
  });
  if (!parsed.success) return { error: formError(parsed.error) };

  try {
    await transition({
      requestId: parsed.data.requestId,
      event: 'FINAL_APPROVED',
      actor: { id: actor.id, roles: actor.roles },
      effects: async (tx) => {
        await tx.approval.create({
          data: {
            requestId: parsed.data.requestId,
            stage: ApprovalStage.HOG_FINAL,
            decision: ApprovalDecision.APPROVED,
            reviewerId: actor.id,
            comments: parsed.data.comments || null,
            decidedAt: new Date(),
          },
        });
      },
    });
  } catch (err) {
    if (err instanceof WorkflowError) return { error: err.message };
    throw err;
  }

  await notifyTransition({
    requestId: parsed.data.requestId,
    event: 'FINAL_APPROVED',
    actor: { id: actor.id, name: actor.name },
  });

  revalidate(parsed.data.requestId);
  return { ok: true };
}

export async function finalRejectAction(formData: FormData) {
  const actor = requireRole(await getSessionUser(), RoleName.HOG);
  // v1.4.1: only requests in their department (lib/department-scope.ts).
  await assertRequestInScope(actor, formData.get('requestId'));
  const parsed = reworkSchema.safeParse({
    requestId: formData.get('requestId'),
    comments: formData.get('comments') ?? '',
  });
  if (!parsed.success) return { error: formError(parsed.error) };

  try {
    await transition({
      requestId: parsed.data.requestId,
      event: 'FINAL_REJECTED',
      actor: { id: actor.id, roles: actor.roles },
      effects: async (tx) => {
        await tx.approval.create({
          data: {
            requestId: parsed.data.requestId,
            stage: ApprovalStage.HOG_FINAL,
            decision: ApprovalDecision.REJECTED,
            reviewerId: actor.id,
            comments: parsed.data.comments,
            decidedAt: new Date(),
          },
        });
      },
    });
  } catch (err) {
    if (err instanceof WorkflowError) return { error: err.message };
    throw err;
  }

  await notifyTransition({
    requestId: parsed.data.requestId,
    event: 'FINAL_REJECTED',
    actor: { id: actor.id, name: actor.name },
  });

  revalidate(parsed.data.requestId);
  return { ok: true };
}

export async function regenerateRecommendationAction(formData: FormData) {
  const actor = requireRole(await getSessionUser(), RoleName.HOG);
  // v1.4.1: only requests in their department (lib/department-scope.ts).
  await assertRequestInScope(actor, formData.get('requestId'));
  if (!aiFeaturesEnabled()) return { error: AI_OFF_MESSAGE };
  const requestId = String(formData.get('requestId') ?? '');
  if (!requestId) return { error: 'Something went wrong — refresh the page and try again.' };
  let count = 0;
  try {
    await clearTodayRecommendations(requestId);
    const res = await recommendFaculty({ requestId, forceRefresh: true }, { actorId: actor.id });
    count = res.candidates?.length ?? 0;
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Recommendation failed' };
  }
  await audit({
    actorId: actor.id,
    action: 'ai.recommend.regenerate',
    entity: 'HandoutRequest',
    entityId: requestId,
    after: { count },
    requestId,
  });
  revalidatePath(`/hog/requests/${requestId}`);
  return { ok: true, actor: actor.id };
}

export async function hogRequestReworkAction(formData: FormData) {
  const actor = requireRole(await getSessionUser(), RoleName.HOG);
  // v1.4.1: only requests in their department (lib/department-scope.ts).
  await assertRequestInScope(actor, formData.get('requestId'));
  const parsed = reworkSchema.safeParse({
    requestId: formData.get('requestId'),
    comments: formData.get('comments') ?? '',
  });
  if (!parsed.success) return { error: formError(parsed.error) };

  try {
    await transition({
      requestId: parsed.data.requestId,
      event: 'REVIEW_REWORK',
      actor: { id: actor.id, roles: actor.roles },
      effects: async (tx) => {
        await tx.approval.create({
          data: {
            requestId: parsed.data.requestId,
            stage: ApprovalStage.HOG_FINAL,
            decision: ApprovalDecision.REWORK,
            reviewerId: actor.id,
            comments: parsed.data.comments,
            decidedAt: new Date(),
          },
        });
      },
    });
  } catch (err) {
    if (err instanceof WorkflowError) return { error: err.message };
    throw err;
  }

  await notifyTransition({
    requestId: parsed.data.requestId,
    event: 'REVIEW_REWORK',
    actor: { id: actor.id, name: actor.name },
  });

  revalidate(parsed.data.requestId);
  return { ok: true };
}

// ── v1.4.1 §A4: the HOG changes a request's PC, with a reason (lib/request-handover.ts) ──────────

export async function changePcAction(formData: FormData): Promise<{ ok?: true; error?: string }> {
  const actor = requireRole(await getSessionUser(), RoleName.HOG);
  await assertRequestInScope(actor, formData.get('requestId'));
  const requestId = String(formData.get('requestId') ?? '');
  const r = await changeHogOrPc({
    requestId,
    role: 'PC',
    toUserId: String(formData.get('toUserId') ?? ''),
    reason: String(formData.get('reason') ?? ''),
    actor: { id: actor.id, name: actor.name },
  });
  if (!r.ok) return { error: r.error };
  revalidatePath(`/hog/requests/${requestId}`);
  revalidatePath('/pc/requests');
  return { ok: true };
}

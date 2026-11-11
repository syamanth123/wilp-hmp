'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma, RoleName, ApprovalStage, ApprovalDecision, HandoutStatus } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { assertRequestInScope } from '@/lib/request-scope';
import { isBackupOf, onBehalfMeta } from '@/lib/backup-access';
import { transition, WorkflowError, movedOnMessage } from '@hmp/workflow';
import { notifyTransition } from '@/lib/notifications';
import { rejectAllocationEffect } from '@/lib/pc-allocation-review';
import { formError } from '@/lib/form-error';

const baseSchema = z.object({
  requestId: z.string().cuid(),
  comments: z.string().max(2000).optional().default(''),
});

const reworkSchema = baseSchema.extend({
  comments: z.string().min(3, 'Rework requires a comment'),
});

function revalidate(requestId: string) {
  revalidatePath(`/pc/requests/${requestId}`);
  revalidatePath('/pc/requests');
  revalidatePath('/pc');
  revalidatePath(`/ic/requests/${requestId}`);
  revalidatePath(`/hog/requests/${requestId}`);
  // Prompt 22: a rejected allocation lands back in HOG's REQUESTED queue list.
  revalidatePath('/hog/requests');
  revalidatePath('/hog');
}

/**
 * v1.4.1: the HOG names the PC who confirms the allocation; only that PC may confirm or send it back.
 * Older requests without a recorded PC can be confirmed by any PC of the department (as before).
 */
async function otherPcMessage(requestId: string, actorId: string): Promise<string | null> {
  const pc = await prisma.requestAssignee.findFirst({
    where: { requestId, role: RoleName.PROGRAMME_COMMITTEE, endedAt: null },
    orderBy: { assignedAt: 'desc' },
    select: { userId: true, user: { select: { name: true } } },
  });
  if (!pc || pc.userId === actorId) return null;
  // v1.4.2 (H18): the away PC's back-up may confirm for them.
  if (await isBackupOf(actorId, pc.userId)) return null;
  return `The HOG asked ${pc.user.name} to confirm this allocation.`;
}

export async function confirmAssignmentAction(formData: FormData) {
  const actor = requireRole(await getSessionUser(), RoleName.PROGRAMME_COMMITTEE);
  // v1.4.1: only requests in their department (lib/department-scope.ts).
  await assertRequestInScope(actor, formData.get('requestId'));
  const parsed = baseSchema.safeParse({
    requestId: formData.get('requestId'),
    comments: formData.get('comments') ?? '',
  });
  if (!parsed.success) return { error: formError(parsed.error) };

  const request = await prisma.handoutRequest.findUnique({ where: { id: parsed.data.requestId } });
  if (!request) return { error: 'This request no longer exists. Refresh the page.' };
  if (request.status !== HandoutStatus.ALLOCATED) {
    return { error: movedOnMessage(request.status) };
  }
  const notYours = await otherPcMessage(parsed.data.requestId, actor.id);
  if (notYours) return { error: notYours };

  try {
    await transition({
      requestId: parsed.data.requestId,
      event: 'ASSIGNED',
      actor: { id: actor.id, roles: actor.roles },
      // v1.4.2 (H18): recorded "for <name>" when acting as an away colleague's back-up.
      meta: await onBehalfMeta(actor, parsed.data.requestId),
      effects: async (tx) => {
        await tx.approval.create({
          data: {
            requestId: parsed.data.requestId,
            stage: ApprovalStage.PC_REVIEW,
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
    event: 'ASSIGNED',
    actor: { id: actor.id, name: actor.name },
  });

  revalidate(parsed.data.requestId);
  return { ok: true };
}

export async function pcRejectAllocationAction(formData: FormData) {
  const actor = requireRole(await getSessionUser(), RoleName.PROGRAMME_COMMITTEE);
  // v1.4.1: only requests in their department (lib/department-scope.ts).
  await assertRequestInScope(actor, formData.get('requestId'));
  const parsed = reworkSchema.safeParse({
    requestId: formData.get('requestId'),
    comments: formData.get('comments') ?? '',
  });
  if (!parsed.success) return { error: formError(parsed.error) };

  const request = await prisma.handoutRequest.findUnique({ where: { id: parsed.data.requestId } });
  if (!request) return { error: 'This request no longer exists. Refresh the page.' };
  if (request.status !== HandoutStatus.ALLOCATED) {
    return { error: movedOnMessage(request.status) };
  }
  const notYours = await otherPcMessage(parsed.data.requestId, actor.id);
  if (notYours) return { error: notYours };

  try {
    await transition({
      requestId: parsed.data.requestId,
      event: 'ALLOCATION_REJECTED',
      actor: { id: actor.id, roles: actor.roles },
      // v1.4.2 (H18): recorded "for <name>" when acting as an away colleague's back-up.
      meta: { reason: parsed.data.comments, ...(await onBehalfMeta(actor, parsed.data.requestId)) },
      // Shared with the bulk path so the destructive multi-step can't drift.
      effects: rejectAllocationEffect(parsed.data.comments, actor.id),
    });
  } catch (err) {
    if (err instanceof WorkflowError) return { error: err.message };
    throw err;
  }

  await notifyTransition({
    requestId: parsed.data.requestId,
    event: 'ALLOCATION_REJECTED',
    actor: { id: actor.id, name: actor.name },
  });

  revalidate(parsed.data.requestId);
  return { ok: true };
}

export async function pcReviewApproveAction(formData: FormData) {
  const actor = requireRole(await getSessionUser(), RoleName.PROGRAMME_COMMITTEE);
  // v1.4.1: only requests in their department (lib/department-scope.ts).
  await assertRequestInScope(actor, formData.get('requestId'));
  const parsed = baseSchema.safeParse({
    requestId: formData.get('requestId'),
    comments: formData.get('comments') ?? '',
  });
  if (!parsed.success) return { error: formError(parsed.error) };

  try {
    await transition({
      requestId: parsed.data.requestId,
      event: 'REVIEW_APPROVED',
      actor: { id: actor.id, roles: actor.roles },
      // v1.4.2 (H18): recorded "for <name>" when acting as an away colleague's back-up.
      meta: await onBehalfMeta(actor, parsed.data.requestId),
      effects: async (tx) => {
        await tx.approval.create({
          data: {
            requestId: parsed.data.requestId,
            stage: ApprovalStage.PC_REVIEW,
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
    event: 'REVIEW_APPROVED',
    actor: { id: actor.id, name: actor.name },
  });

  revalidate(parsed.data.requestId);
  return { ok: true };
}

export async function pcReviewReworkAction(formData: FormData) {
  const actor = requireRole(await getSessionUser(), RoleName.PROGRAMME_COMMITTEE);
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
      // v1.4.2 (H18): recorded "for <name>" when acting as an away colleague's back-up.
      meta: await onBehalfMeta(actor, parsed.data.requestId),
      effects: async (tx) => {
        await tx.approval.create({
          data: {
            requestId: parsed.data.requestId,
            stage: ApprovalStage.PC_REVIEW,
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

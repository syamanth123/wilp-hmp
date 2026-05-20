'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  prisma,
  RoleName,
  ApprovalStage,
  ApprovalDecision,
  HandoutStatus,
} from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { transition, WorkflowError } from '@hmp/workflow';
import { notifyTransition, notifySmeNomination } from '@/lib/notifications';
import { createSmeNomination, NominationError } from './sme-nomination';

const baseSchema = z.object({
  requestId: z.string().cuid(),
  comments: z.string().max(2000).optional().default(''),
});

const nominateSchema = z.object({
  requestId: z.string().cuid(),
  smeUserId: z.string().cuid(),
  topic: z.string().min(1, 'Topic is required').max(200, 'Topic must be 200 characters or fewer'),
  notes: z.string().max(2000, 'Notes must be 2000 characters or fewer').optional().default(''),
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
}

export async function confirmAssignmentAction(formData: FormData) {
  const actor = requireRole(await getSessionUser(), RoleName.PROGRAMME_COMMITTEE);
  const parsed = baseSchema.safeParse({
    requestId: formData.get('requestId'),
    comments: formData.get('comments') ?? '',
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  const request = await prisma.handoutRequest.findUnique({ where: { id: parsed.data.requestId } });
  if (!request) return { error: 'Request not found' };
  if (request.status !== HandoutStatus.ALLOCATED) {
    return { error: `Cannot confirm assignment from status ${request.status}` };
  }

  try {
    await transition({
      requestId: parsed.data.requestId,
      event: 'ASSIGNED',
      actor: { id: actor.id, roles: actor.roles },
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

export async function pcReviewApproveAction(formData: FormData) {
  const actor = requireRole(await getSessionUser(), RoleName.PROGRAMME_COMMITTEE);
  const parsed = baseSchema.safeParse({
    requestId: formData.get('requestId'),
    comments: formData.get('comments') ?? '',
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  try {
    await transition({
      requestId: parsed.data.requestId,
      event: 'REVIEW_APPROVED',
      actor: { id: actor.id, roles: actor.roles },
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
  const parsed = reworkSchema.safeParse({
    requestId: formData.get('requestId'),
    comments: formData.get('comments') ?? '',
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Rework requires a comment' };

  try {
    await transition({
      requestId: parsed.data.requestId,
      event: 'REVIEW_REWORK',
      actor: { id: actor.id, roles: actor.roles },
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

/**
 * PC nominates a Subject Matter Expert to advise on a handout. Does NOT
 * transition the workflow state — the SmeNomination has its own status
 * lifecycle (PENDING / ACCEPTED / DECLINED / COMPLETED) independent of
 * HandoutStatus.
 *
 * The business logic lives in `createSmeNomination` (sme-nomination.ts) so
 * it's unit-testable without mocking NextAuth / revalidatePath. This wrapper
 * does auth + Zod validation + invokes the helper inside a $transaction +
 * fires the notification + revalidates.
 */
export async function nominateSmeAction(
  formData: FormData,
): Promise<{ ok: true; nominationId: string } | { error: string }> {
  const actor = requireRole(await getSessionUser(), RoleName.PROGRAMME_COMMITTEE);
  const parsed = nominateSchema.safeParse({
    requestId: formData.get('requestId'),
    smeUserId: formData.get('smeUserId'),
    topic: formData.get('topic'),
    notes: formData.get('notes') ?? '',
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  let nominationId: string;
  try {
    const result = await prisma.$transaction((tx) =>
      createSmeNomination(
        {
          requestId: parsed.data.requestId,
          smeUserId: parsed.data.smeUserId,
          nominatedById: actor.id,
          topic: parsed.data.topic,
          notes: parsed.data.notes || null,
        },
        tx,
      ),
    );
    nominationId = result.id;
  } catch (err) {
    if (err instanceof NominationError) return { error: err.message };
    throw err;
  }

  // Best-effort notification — wrapped internally in try/catch so it never
  // throws back to the action. Template `handout.sme_nominated` doesn't
  // exist in the DB yet; Prompt 8 will add it. Until then the inline
  // fallback wording inside notifySmeNomination is the production copy.
  await notifySmeNomination({
    requestId: parsed.data.requestId,
    nominationId,
    smeUserId: parsed.data.smeUserId,
    topic: parsed.data.topic,
    actor: { id: actor.id, name: actor.name },
  });

  revalidate(parsed.data.requestId);
  return { ok: true, nominationId };
}

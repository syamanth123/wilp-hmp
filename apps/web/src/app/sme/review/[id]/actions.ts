'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { RoleName } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { WorkflowError } from '@hmp/workflow';
import { notifyTransition } from '@/lib/notifications';
import { smeApprove, smeRevert, SmeReviewError } from './sme-review';

/**
 * SME approval-workflow server actions (Prompt 12-a). Thin auth + Zod +
 * revalidate wrappers around the testable helpers in sme-review.ts.
 *
 * 12-a ships these actions + the workflow engine; the SME approval-queue UI
 * that invokes them lands in 12-b. In 12-a they're exercised via the
 * integration test and the manual production-build walkthrough (calling the
 * action directly / via a scratch page).
 */

const approveSchema = z.object({ requestId: z.string().cuid() });
const revertSchema = z.object({
  requestId: z.string().cuid(),
  comments: z.string().min(3, 'A comment is required when reverting to faculty').max(2000),
});

function revalidate(requestId: string) {
  revalidatePath(`/sme/review/${requestId}`);
  revalidatePath('/sme/review');
  revalidatePath('/sme');
  // The handout also surfaces on faculty / PC / IC / HOG detail + list views.
  revalidatePath(`/faculty/assignments/${requestId}`);
  revalidatePath(`/pc/requests/${requestId}`);
  revalidatePath(`/hog/requests/${requestId}`);
  revalidatePath(`/ic/requests/${requestId}`);
}

export async function smeApproveAction(formData: FormData) {
  const me = requireRole(await getSessionUser(), RoleName.SME);
  const parsed = approveSchema.safeParse({ requestId: formData.get('requestId') });
  if (!parsed.success) return { error: 'Invalid input' };

  try {
    await smeApprove(parsed.data.requestId, { id: me.id, roles: me.roles });
  } catch (err) {
    if (err instanceof WorkflowError || err instanceof SmeReviewError) {
      return { error: err.message };
    }
    throw err;
  }

  // Notify faculty + IC + PC that the handout cleared the SME gate (recipients
  // resolved per-event in computeRecipients). Best-effort: notifyTransition
  // swallows its own failures, so a notification hiccup never fails the action.
  await notifyTransition({
    requestId: parsed.data.requestId,
    event: 'SME_APPROVED',
    actor: { id: me.id, name: me.name },
  });

  revalidate(parsed.data.requestId);
  return { ok: true };
}

export async function smeRevertAction(formData: FormData) {
  const me = requireRole(await getSessionUser(), RoleName.SME);
  const parsed = revertSchema.safeParse({
    requestId: formData.get('requestId'),
    comments: formData.get('comments') ?? '',
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  try {
    await smeRevert(parsed.data.requestId, { id: me.id, roles: me.roles }, parsed.data.comments);
  } catch (err) {
    if (err instanceof WorkflowError || err instanceof SmeReviewError) {
      return { error: err.message };
    }
    throw err;
  }

  // Notify faculty + IC that the SME sent the handout back for changes.
  await notifyTransition({
    requestId: parsed.data.requestId,
    event: 'SME_REVERTED',
    actor: { id: me.id, name: me.name },
  });

  revalidate(parsed.data.requestId);
  return { ok: true };
}

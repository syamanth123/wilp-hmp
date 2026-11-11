'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma, DeadlineStage } from '@hmp/db';
import { getSessionUser } from '@hmp/auth';
import { audit } from '@/lib/audit';
import { canChangeDeadlines } from '@/lib/deadline-access';

/** v1.4.2 — change one stage's due date on one request (IC / Admin, or the request's HOG), with a reason. */

const schema = z.object({
  requestId: z.string().cuid(),
  stage: z.nativeEnum(DeadlineStage),
  dueOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date.')
    .or(z.literal('')),
  reason: z.string().trim().min(3, 'Say why (a few words).').max(300),
});

export async function setDeadlineAction(
  formData: FormData,
): Promise<{ ok: true } | { error: string }> {
  const me = await getSessionUser();
  if (!me) return { error: 'Your session has ended. Sign in again.' };
  const parsed = schema.safeParse({
    requestId: formData.get('requestId'),
    stage: formData.get('stage'),
    dueOn: formData.get('dueOn') ?? '',
    reason: formData.get('reason') ?? '',
  });
  if (!parsed.success)
    return { error: parsed.error.issues[0]?.message ?? 'Check the date and the reason.' };
  const { requestId, stage, dueOn, reason } = parsed.data;
  if (!(await canChangeDeadlines(me, requestId)))
    return { error: 'Only the Instruction Cell or this request’s HOG can change its due dates.' };

  const before = await prisma.requestDeadline.findUnique({
    where: { requestId_stage: { requestId, stage } },
    select: { dueAt: true },
  });
  if (!dueOn) {
    // Back to the usual rule.
    if (before)
      await prisma.requestDeadline.delete({ where: { requestId_stage: { requestId, stage } } });
    await audit({
      actorId: me.id,
      action: 'request.deadline-cleared',
      entity: 'HandoutRequest',
      entityId: requestId,
      requestId,
      before: before ? { stage, dueAt: before.dueAt } : null,
      after: { stage, reason },
    });
  } else {
    const dueAt = new Date(`${dueOn}T00:00:00+05:30`);
    await prisma.requestDeadline.upsert({
      where: { requestId_stage: { requestId, stage } },
      create: { requestId, stage, dueAt, reason, setById: me.id },
      update: { dueAt, reason, setById: me.id },
    });
    await audit({
      actorId: me.id,
      action: 'request.deadline',
      entity: 'HandoutRequest',
      entityId: requestId,
      requestId,
      before: before ? { stage, dueAt: before.dueAt } : null,
      after: { stage, dueAt, reason },
    });
  }
  for (const p of ['/ic/requests', '/hog/requests', '/pc/requests', '/faculty/assignments'])
    revalidatePath(`${p}/${requestId}`);
  return { ok: true };
}

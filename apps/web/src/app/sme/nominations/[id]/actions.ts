'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma, RoleName } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import {
  acceptNomination,
  declineNomination,
  completeNomination,
  SmeResponseError,
} from './sme-response';
import {
  notifySmeAccepted,
  notifySmeDeclined,
  notifySmeCompleted,
} from '@/lib/notifications';

const idOnlySchema = z.object({
  nominationId: z.string().cuid(),
});

const declineSchema = z.object({
  nominationId: z.string().cuid(),
  reason: z
    .string()
    .min(1, 'Reason is required when declining')
    .max(500, 'Reason must be 500 characters or fewer'),
});

function revalidate(nominationId: string) {
  revalidatePath(`/sme/nominations/${nominationId}`);
  revalidatePath('/sme/nominations');
  revalidatePath('/sme');
}

/**
 * Loads a nomination's requestId so notifications + cross-area revalidation
 * can target the right paths. Run after the helper has already verified
 * ownership in-transaction; this read just gathers downstream context.
 */
async function readNominationContext(nominationId: string) {
  return prisma.smeNomination.findUnique({
    where: { id: nominationId },
    select: { id: true, requestId: true, nominatedById: true, smeUserId: true, topic: true },
  });
}

export async function acceptNominationAction(
  formData: FormData,
): Promise<{ ok: true } | { error: string }> {
  const actor = requireRole(await getSessionUser(), RoleName.SME);
  const parsed = idOnlySchema.safeParse({ nominationId: formData.get('nominationId') });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  try {
    await prisma.$transaction((tx) =>
      acceptNomination({ nominationId: parsed.data.nominationId, smeUserId: actor.id }, tx),
    );
  } catch (err) {
    if (err instanceof SmeResponseError) return { error: err.message };
    throw err;
  }

  const ctx = await readNominationContext(parsed.data.nominationId);
  if (ctx) {
    await notifySmeAccepted({
      requestId: ctx.requestId,
      nominationId: ctx.id,
      smeUserId: ctx.smeUserId,
      actor: { id: actor.id, name: actor.name },
    });
    revalidatePath(`/pc/requests/${ctx.requestId}`);
  }

  revalidate(parsed.data.nominationId);
  return { ok: true };
}

export async function declineNominationAction(
  formData: FormData,
): Promise<{ ok: true } | { error: string }> {
  const actor = requireRole(await getSessionUser(), RoleName.SME);
  const parsed = declineSchema.safeParse({
    nominationId: formData.get('nominationId'),
    reason: formData.get('reason'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  try {
    await prisma.$transaction((tx) =>
      declineNomination(
        {
          nominationId: parsed.data.nominationId,
          smeUserId: actor.id,
          reason: parsed.data.reason,
        },
        tx,
      ),
    );
  } catch (err) {
    if (err instanceof SmeResponseError) return { error: err.message };
    throw err;
  }

  const ctx = await readNominationContext(parsed.data.nominationId);
  if (ctx) {
    await notifySmeDeclined({
      requestId: ctx.requestId,
      nominationId: ctx.id,
      smeUserId: ctx.smeUserId,
      reason: parsed.data.reason,
      actor: { id: actor.id, name: actor.name },
    });
    revalidatePath(`/pc/requests/${ctx.requestId}`);
  }

  revalidate(parsed.data.nominationId);
  return { ok: true };
}

export async function markNominationCompleteAction(
  formData: FormData,
): Promise<{ ok: true } | { error: string }> {
  const actor = requireRole(await getSessionUser(), RoleName.SME);
  const parsed = idOnlySchema.safeParse({ nominationId: formData.get('nominationId') });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  try {
    await prisma.$transaction((tx) =>
      completeNomination({ nominationId: parsed.data.nominationId, smeUserId: actor.id }, tx),
    );
  } catch (err) {
    if (err instanceof SmeResponseError) return { error: err.message };
    throw err;
  }

  const ctx = await readNominationContext(parsed.data.nominationId);
  if (ctx) {
    await notifySmeCompleted({
      requestId: ctx.requestId,
      nominationId: ctx.id,
      smeUserId: ctx.smeUserId,
      actor: { id: actor.id, name: actor.name },
    });
    revalidatePath(`/pc/requests/${ctx.requestId}`);
    revalidatePath(`/faculty/assignments/${ctx.requestId}`);
  }

  revalidate(parsed.data.nominationId);
  return { ok: true };
}

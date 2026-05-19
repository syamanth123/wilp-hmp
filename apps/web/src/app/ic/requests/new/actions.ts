'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma, RoleName } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { transition } from '@hmp/workflow';
import { notifyTransition } from '@/lib/notifications';
import { createRequestWithRefNo, RefNoRetryExhausted } from './ref-no';

const schema = z.object({
  courseOfferingId: z.string().cuid(),
  notes: z.string().max(2000).optional().default(''),
  previousHandoutUrl: z.string().url().optional().or(z.literal('')),
});

export async function createRequestAction(formData: FormData) {
  const actor = requireRole(await getSessionUser(), RoleName.INSTRUCTION_CELL);
  const parsed = schema.safeParse({
    courseOfferingId: formData.get('courseOfferingId'),
    notes: formData.get('notes') ?? '',
    previousHandoutUrl: formData.get('previousHandoutUrl') ?? '',
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  const offering = await prisma.courseOffering.findUnique({
    where: { id: parsed.data.courseOfferingId },
  });
  if (!offering) return { error: 'Course offering not found' };

  let created: { id: string; refNo: string };
  try {
    created = await prisma.$transaction(async (tx) => {
      const req = await createRequestWithRefNo(
        {
          courseOfferingId: offering.id,
          initiatedById: actor.id,
          notes: parsed.data.notes || null,
          previousHandoutUrl: parsed.data.previousHandoutUrl || null,
        },
        tx,
      );
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'request.create',
          entity: 'HandoutRequest',
          entityId: req.id,
          after: { refNo: req.refNo, courseOfferingId: offering.id } as never,
          requestId: req.id,
        },
      });
      return req;
    });
  } catch (err) {
    if (err instanceof RefNoRetryExhausted) {
      console.error('[createRequest] refNo exhaustion', err);
      return { error: 'Could not create request right now — please retry.' };
    }
    throw err;
  }

  await transition({
    requestId: created.id,
    event: 'REQUEST_INITIATED',
    actor: { id: actor.id, roles: actor.roles },
  });

  await notifyTransition({
    requestId: created.id,
    event: 'REQUEST_INITIATED',
    actor: { id: actor.id, name: actor.name },
  });

  revalidatePath('/ic/requests');
  redirect(`/ic/requests/${created.id}`);
}

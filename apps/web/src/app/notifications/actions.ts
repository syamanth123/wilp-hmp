'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma, NotificationStatus } from '@hmp/db';
import { getSessionUser } from '@hmp/auth';
import { GENERIC_ERROR } from '@/lib/form-error';

const idSchema = z.object({ id: z.string().cuid() });

export async function markReadAction(formData: FormData) {
  const me = await getSessionUser();
  if (!me) return { error: 'Your session has ended. Sign in again.' };
  const parsed = idSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success) return { error: GENERIC_ERROR };

  await prisma.notification.updateMany({
    where: { id: parsed.data.id, userId: me.id },
    data: { status: NotificationStatus.READ, readAt: new Date() },
  });
  revalidatePath('/notifications');
  return { ok: true };
}

export async function markAllReadAction() {
  const me = await getSessionUser();
  if (!me) return { error: 'Your session has ended. Sign in again.' };
  await prisma.notification.updateMany({
    where: {
      userId: me.id,
      status: { in: [NotificationStatus.PENDING, NotificationStatus.SENT] },
    },
    data: { status: NotificationStatus.READ, readAt: new Date() },
  });
  revalidatePath('/notifications');
  return { ok: true };
}

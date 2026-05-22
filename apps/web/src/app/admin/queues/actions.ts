'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { RoleName } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { getNotificationsQueue, getAiQueue, type Queue } from '@hmp/queue';

const schema = z.object({
  queue: z.enum(['notifications', 'ai']),
  jobId: z.string().min(1),
});

const clearSchema = z.object({ queue: z.enum(['notifications', 'ai']) });

function queueByName(name: 'notifications' | 'ai'): Queue {
  return name === 'notifications' ? getNotificationsQueue() : getAiQueue();
}

export async function retryFailedJobAction(formData: FormData) {
  requireRole(await getSessionUser(), RoleName.ADMIN);
  const parsed = schema.safeParse({ queue: formData.get('queue'), jobId: formData.get('jobId') });
  if (!parsed.success) return { error: 'Invalid input' };
  try {
    const job = await queueByName(parsed.data.queue).getJob(parsed.data.jobId);
    if (!job) return { error: 'Job not found (may have been cleaned).' };
    // Re-enqueues for another attempt. A PermanentJobError job will fail again
    // immediately with the same reason — that's the honest signal.
    await job.retry();
  } catch (err) {
    return { error: `Retry failed: ${(err as Error).message}` };
  }
  revalidatePath('/admin/queues');
  return { ok: true };
}

export async function deleteFailedJobAction(formData: FormData) {
  requireRole(await getSessionUser(), RoleName.ADMIN);
  const parsed = schema.safeParse({ queue: formData.get('queue'), jobId: formData.get('jobId') });
  if (!parsed.success) return { error: 'Invalid input' };
  try {
    const job = await queueByName(parsed.data.queue).getJob(parsed.data.jobId);
    if (!job) return { error: 'Job not found.' };
    await job.remove();
  } catch (err) {
    return { error: `Delete failed: ${(err as Error).message}` };
  }
  revalidatePath('/admin/queues');
  return { ok: true };
}

export async function clearCompletedAction(formData: FormData) {
  requireRole(await getSessionUser(), RoleName.ADMIN);
  const parsed = clearSchema.safeParse({ queue: formData.get('queue') });
  if (!parsed.success) return { error: 'Invalid input' };
  try {
    // grace 0 = clean all completed regardless of age; up to 1000 at a time.
    await queueByName(parsed.data.queue).clean(0, 1000, 'completed');
  } catch (err) {
    return { error: `Clear failed: ${(err as Error).message}` };
  }
  revalidatePath('/admin/queues');
  return { ok: true };
}

'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { RoleName } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { getNotificationsQueue, getAiQueue, type Queue } from '@hmp/queue';
import { AI_OFF_MESSAGE, aiFeaturesEnabled } from '@/lib/features';
import { GENERIC_ERROR } from '@/lib/form-error';

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
  if (!parsed.success) return { error: GENERIC_ERROR };
  if (parsed.data.queue === 'ai' && !aiFeaturesEnabled()) return { error: AI_OFF_MESSAGE };
  try {
    const job = await queueByName(parsed.data.queue).getJob(parsed.data.jobId);
    if (!job) return { error: 'This job no longer exists — refresh the page.' };
    // Re-enqueues for another attempt. A PermanentJobError job will fail again
    // immediately with the same reason — that's the honest signal.
    await job.retry();
  } catch (err) {
    console.error('queue_retry_failed', err);
    return { error: "Couldn't retry the job. Please try again." };
  }
  revalidatePath('/admin/queues');
  return { ok: true };
}

export async function deleteFailedJobAction(formData: FormData) {
  requireRole(await getSessionUser(), RoleName.ADMIN);
  const parsed = schema.safeParse({ queue: formData.get('queue'), jobId: formData.get('jobId') });
  if (!parsed.success) return { error: GENERIC_ERROR };
  if (parsed.data.queue === 'ai' && !aiFeaturesEnabled()) return { error: AI_OFF_MESSAGE };
  try {
    const job = await queueByName(parsed.data.queue).getJob(parsed.data.jobId);
    if (!job) return { error: 'This job no longer exists — refresh the page.' };
    await job.remove();
  } catch (err) {
    console.error('queue_delete_failed', err);
    return { error: "Couldn't delete the job. Please try again." };
  }
  revalidatePath('/admin/queues');
  return { ok: true };
}

export async function clearCompletedAction(formData: FormData) {
  requireRole(await getSessionUser(), RoleName.ADMIN);
  const parsed = clearSchema.safeParse({ queue: formData.get('queue') });
  if (!parsed.success) return { error: GENERIC_ERROR };
  if (parsed.data.queue === 'ai' && !aiFeaturesEnabled()) return { error: AI_OFF_MESSAGE };
  try {
    // grace 0 = clean all completed regardless of age; up to 1000 at a time.
    await queueByName(parsed.data.queue).clean(0, 1000, 'completed');
  } catch (err) {
    console.error('queue_clear_failed', err);
    return { error: "Couldn't clear finished jobs. Please try again." };
  }
  revalidatePath('/admin/queues');
  return { ok: true };
}

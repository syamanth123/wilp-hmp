'use server';

import { revalidatePath } from 'next/cache';
import { RoleName } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { bulkReview, type BulkReviewResult } from '@/lib/bulk-review';
import { PC_CONFIG } from './config';

export async function pcBulkReviewAction(formData: FormData): Promise<BulkReviewResult> {
  const actor = requireRole(await getSessionUser(), RoleName.PROGRAMME_COMMITTEE);
  const result = await bulkReview(PC_CONFIG, String(formData.get('csv') ?? ''), {
    id: actor.id,
    roles: actor.roles,
    name: actor.name,
  });
  if (result.status !== 'rejected') {
    revalidatePath('/pc/requests');
    revalidatePath('/pc');
  }
  return result;
}

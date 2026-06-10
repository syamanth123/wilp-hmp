'use server';

import { revalidatePath } from 'next/cache';
import { RoleName } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { bulkReview, type BulkReviewResult } from '@/lib/bulk-review';
import { HOG_CONFIG } from './config';

export async function hogBulkReviewAction(formData: FormData): Promise<BulkReviewResult> {
  const actor = requireRole(await getSessionUser(), RoleName.HOG);
  const result = await bulkReview(HOG_CONFIG, String(formData.get('csv') ?? ''), {
    id: actor.id,
    roles: actor.roles,
    name: actor.name,
  });
  if (result.status !== 'rejected') {
    revalidatePath('/hog/requests');
    revalidatePath('/hog');
  }
  return result;
}

'use server';

import { revalidatePath } from 'next/cache';
import { RoleName } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { bulkReview, type BulkReviewResult } from '@/lib/bulk-review';
import { SME_CONFIG } from './config';

export async function smeBulkReviewAction(formData: FormData): Promise<BulkReviewResult> {
  const actor = requireRole(await getSessionUser(), RoleName.SME);
  const result = await bulkReview(SME_CONFIG, String(formData.get('csv') ?? ''), {
    id: actor.id,
    roles: actor.roles,
    name: actor.name,
  });
  if (result.status !== 'rejected') {
    revalidatePath('/sme/review');
    revalidatePath('/sme');
  }
  return result;
}

'use server';

import { revalidatePath } from 'next/cache';
import { RoleName } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { bulkAllocate, type BulkAllocateResult } from './bulk-allocate';

/**
 * HOG bulk faculty + SME allocation (Prompt 14). Thin auth + revalidate wrapper
 * around the testable bulkAllocate pipeline. The client posts the chosen .csv
 * file's text as the `csv` field.
 */
export async function bulkAllocateAction(formData: FormData): Promise<BulkAllocateResult> {
  const actor = requireRole(await getSessionUser(), RoleName.HOG);
  const csv = String(formData.get('csv') ?? '');

  const result = await bulkAllocate(csv, { id: actor.id, roles: actor.roles, name: actor.name });

  if (result.status === 'success' || result.status === 'partial') {
    revalidatePath('/hog/requests');
    revalidatePath('/hog');
  }
  return result;
}

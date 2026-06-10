'use server';

import { revalidatePath } from 'next/cache';
import { RoleName } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { bulkCreateHandouts, type BulkUploadResult } from './bulk-create';

/**
 * IC bulk handout-request upload (Prompt 13). Thin auth + revalidate wrapper
 * around the testable bulkCreateHandouts pipeline (bulk-create.ts). The client
 * reads the chosen .csv file and posts its text as the `csv` field.
 */
export async function bulkCreateHandoutsAction(formData: FormData): Promise<BulkUploadResult> {
  const actor = requireRole(await getSessionUser(), RoleName.INSTRUCTION_CELL);
  const csv = String(formData.get('csv') ?? '');

  const result = await bulkCreateHandouts(csv, {
    id: actor.id,
    roles: actor.roles,
    name: actor.name,
  });

  if (result.status === 'success' || result.status === 'partial') {
    revalidatePath('/ic/requests');
    revalidatePath('/ic');
  }
  return result;
}

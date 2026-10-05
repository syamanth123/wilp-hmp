'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma, RoleName } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { publishDibbaImport } from '@hmp/db/src/dibba-import';
import { dibbaErrorMessage } from '../errors';

const schema = z.object({ importId: z.string().cuid() });

/**
 * Publish a DRAFT import (plan D3): the db core does the one-transaction swap
 * (term row lock, supersede the current PUBLISHED, conditional flip, audit);
 * this wrapper is auth + zod + revalidate + the D11 error copy.
 */
export async function publishImportAction(
  formData: FormData,
): Promise<{ ok: true; supersededCount: number } | { error: string }> {
  const me = requireRole(await getSessionUser(), RoleName.INSTRUCTION_CELL);
  const parsed = schema.safeParse({ importId: formData.get('importId') });
  if (!parsed.success) return { error: 'Invalid input' };
  try {
    const result = await publishDibbaImport(prisma, {
      importId: parsed.data.importId,
      actorId: me.id,
    });
    revalidatePath('/ic/dibba');
    revalidatePath(`/ic/dibba/${parsed.data.importId}`);
    return { ok: true, supersededCount: result.supersededIds.length };
  } catch (err) {
    return { error: dibbaErrorMessage(err, 'publish') };
  }
}

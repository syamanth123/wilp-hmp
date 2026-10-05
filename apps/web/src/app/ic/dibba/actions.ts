'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma, RoleName } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { createAcademicTerm, discardDibbaImport } from '@hmp/db/src/dibba-import';
import { dibbaErrorMessage } from './errors';

/**
 * IC Course Dibba — list-page mutations (Phase 3, plan §2/D5/D9/D11). Thin
 * wrappers: auth, zod, the db core, revalidate. The upload itself is a Route
 * Handler (api/ic/dibba-imports/upload), not an action.
 */

/** Parse `YYYY-MM-DD` as local midnight so the rendered date doesn't slip a day in +UTC zones. */
function parseDateLocal(s: string): Date {
  const [y, m, d] = s.split('-').map((p) => Number(p));
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter dates as YYYY-MM-DD')
  .transform(parseDateLocal);

const createTermSchema = z
  .object({
    name: z.string().trim().min(1, 'Term name is required').max(120, 'Term name is too long'),
    year: z.coerce.number().int().min(2000, 'Year looks wrong').max(2100, 'Year looks wrong'),
    term: z.enum(['FIRST', 'SECOND', 'SUMMER'], { message: 'Pick FIRST, SECOND or SUMMER' }),
    startDate: isoDate,
    endDate: isoDate,
  })
  .refine((d) => d.endDate > d.startDate, {
    message: 'End date must be after the start date',
    path: ['endDate'],
  });

export async function createTermAction(
  formData: FormData,
): Promise<{ ok: true; termId: string } | { error: string }> {
  const me = requireRole(await getSessionUser(), RoleName.INSTRUCTION_CELL);
  const parsed = createTermSchema.safeParse({
    name: formData.get('name'),
    year: formData.get('year'),
    term: formData.get('term'),
    startDate: formData.get('startDate'),
    endDate: formData.get('endDate'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }
  try {
    const { termId } = await createAcademicTerm(prisma, { ...parsed.data, actorId: me.id });
    revalidatePath('/ic/dibba');
    return { ok: true, termId };
  } catch (err) {
    return { error: dibbaErrorMessage(err, 'create the term') };
  }
}

const importIdSchema = z.object({ importId: z.string().cuid() });

export async function discardDraftAction(
  formData: FormData,
): Promise<{ ok: true } | { error: string }> {
  const me = requireRole(await getSessionUser(), RoleName.INSTRUCTION_CELL);
  const parsed = importIdSchema.safeParse({ importId: formData.get('importId') });
  if (!parsed.success) return { error: 'Invalid input' };
  try {
    await discardDibbaImport(prisma, { importId: parsed.data.importId, actorId: me.id });
    revalidatePath('/ic/dibba');
    return { ok: true };
  } catch (err) {
    return { error: dibbaErrorMessage(err, 'discard the draft') };
  }
}

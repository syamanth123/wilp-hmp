'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma, RoleName } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { updateAcademicTerm } from '@hmp/db/src/dibba-import';
import { dibbaErrorMessage } from '../../errors';
import { isoDate } from '../../date-input';
import { formError } from '@/lib/form-error';

/** Term edit (Phase 4, plan D3): auth, zod, db core, revalidate — nothing else. */

const updateTermSchema = z
  .object({
    termId: z.string().cuid(),
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

export async function updateTermAction(
  formData: FormData,
): Promise<{ ok: true } | { error: string }> {
  const me = requireRole(await getSessionUser(), RoleName.INSTRUCTION_CELL);
  const parsed = updateTermSchema.safeParse({
    termId: formData.get('termId'),
    name: formData.get('name'),
    year: formData.get('year'),
    term: formData.get('term'),
    startDate: formData.get('startDate'),
    endDate: formData.get('endDate'),
  });
  if (!parsed.success) {
    return { error: formError(parsed.error) };
  }
  try {
    await updateAcademicTerm(prisma, { ...parsed.data, actorId: me.id });
    revalidatePath('/ic/dibba');
    revalidatePath(`/ic/dibba/terms/${parsed.data.termId}`);
    return { ok: true };
  } catch (err) {
    return { error: dibbaErrorMessage(err, 'save the term') };
  }
}

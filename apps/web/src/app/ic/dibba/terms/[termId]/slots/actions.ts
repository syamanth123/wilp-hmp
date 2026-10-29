'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma, RoleName } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { updateSlotTimings, upsertSlotExamDates } from '@hmp/db/src/dibba-import';
import { dibbaErrorMessage } from '../../../errors';
import { EXAM_KINDS, classTimesFromForm, examDatesFromForm, firstIssueMessage } from './schemas';
import { GENERIC_ERROR } from '@/lib/form-error';

/** Class times + exam dates (Phase 4, plan D4/D5): auth, shape, db core, revalidate. */

const termIdSchema = z.string().cuid();

function paths(termId: string): void {
  revalidatePath(`/ic/dibba/terms/${termId}/slots`);
  revalidatePath(`/ic/dibba/terms/${termId}`);
  revalidatePath('/ic/dibba');
}

export async function saveSlotTimingsAction(
  formData: FormData,
): Promise<{ ok: true; changed: number[] } | { error: string }> {
  const me = requireRole(await getSessionUser(), RoleName.INSTRUCTION_CELL);
  const termId = termIdSchema.safeParse(formData.get('termId'));
  if (!termId.success) return { error: GENERIC_ERROR };
  const rows = classTimesFromForm(formData);
  if (!rows.success) return { error: firstIssueMessage(rows.error.issues, 'Invalid input') };
  try {
    const { changed } = await updateSlotTimings(prisma, {
      termId: termId.data,
      timings: rows.data,
      actorId: me.id,
    });
    paths(termId.data);
    return { ok: true, changed };
  } catch (err) {
    return { error: dibbaErrorMessage(err, 'save the class times') };
  }
}

export async function saveExamDatesAction(
  formData: FormData,
): Promise<{ ok: true; upserted: number; deleted: number } | { error: string }> {
  const me = requireRole(await getSessionUser(), RoleName.INSTRUCTION_CELL);
  const termId = termIdSchema.safeParse(formData.get('termId'));
  if (!termId.success) return { error: GENERIC_ERROR };
  const rows = examDatesFromForm(formData);
  if (!rows.success)
    return { error: firstIssueMessage(rows.error.issues, 'Invalid input', EXAM_KINDS.length) };
  try {
    const r = await upsertSlotExamDates(prisma, {
      termId: termId.data,
      dates: rows.data,
      actorId: me.id,
    });
    paths(termId.data);
    return { ok: true, ...r };
  } catch (err) {
    return { error: dibbaErrorMessage(err, 'save the exam dates') };
  }
}

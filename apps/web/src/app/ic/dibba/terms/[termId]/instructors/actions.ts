'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma, RoleName } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { addCourseInstructor, removeCourseInstructor } from '@hmp/db/src/dibba-import';
import { dibbaErrorMessage } from '../../../errors';
import { GENERIC_ERROR, formError } from '@/lib/form-error';

/** Manual instructor add / remove (Phase 4, plan D7). The sheet upload is a Route Handler. */

function paths(termId: string): void {
  revalidatePath(`/ic/dibba/terms/${termId}/instructors`);
  revalidatePath(`/ic/dibba/terms/${termId}`);
  revalidatePath('/ic/dibba');
}

const addSchema = z.object({
  termId: z.string().cuid(),
  courseCode: z.string().trim().min(1, 'Enter a course code').max(60, 'Course code is too long'),
  email: z.string().trim().email('Enter a valid email'),
  isLead: z.boolean(),
});

export async function addInstructorAction(
  formData: FormData,
): Promise<{ ok: true; courseCode: string } | { error: string }> {
  const me = requireRole(await getSessionUser(), RoleName.INSTRUCTION_CELL);
  const parsed = addSchema.safeParse({
    termId: formData.get('termId'),
    courseCode: formData.get('courseCode'),
    email: formData.get('email'),
    isLead: formData.get('isLead') === 'on',
  });
  if (!parsed.success) return { error: formError(parsed.error) };
  try {
    const r = await addCourseInstructor(prisma, { ...parsed.data, actorId: me.id });
    paths(parsed.data.termId);
    return { ok: true, courseCode: r.courseCode };
  } catch (err) {
    return { error: dibbaErrorMessage(err, 'add the instructor') };
  }
}

const removeSchema = z.object({ id: z.string().cuid(), termId: z.string().cuid() });

export async function removeInstructorAction(
  formData: FormData,
): Promise<{ ok: true } | { error: string }> {
  const me = requireRole(await getSessionUser(), RoleName.INSTRUCTION_CELL);
  const parsed = removeSchema.safeParse({ id: formData.get('id'), termId: formData.get('termId') });
  if (!parsed.success) return { error: GENERIC_ERROR };
  try {
    await removeCourseInstructor(prisma, { id: parsed.data.id, actorId: me.id });
    paths(parsed.data.termId);
    return { ok: true };
  } catch (err) {
    return { error: dibbaErrorMessage(err, 'remove the instructor') };
  }
}

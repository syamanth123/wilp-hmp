'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma, RoleName } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { audit } from '@/lib/audit';

/** Parse `YYYY-MM-DD` as local midnight so the rendered date doesn't slip a day in +UTC zones. */
function parseDateLocal(s: string): Date {
  const [y, m, d] = s.split('-').map((p) => Number(p));
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

const dateOrNull = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : null))
  .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isNaN(Date.parse(v)), {
    message: 'Invalid date',
  })
  .transform((v) =>
    v === null ? null : /^\d{4}-\d{2}-\d{2}$/.test(v) ? parseDateLocal(v) : new Date(v),
  );

const schema = z.object({
  semesterId: z.string().cuid(),
  examDate: dateOrNull,
  ec1Deadline: dateOrNull,
});

export async function updateSemesterDatesAction(formData: FormData) {
  const me = requireRole(await getSessionUser(), RoleName.INSTRUCTION_CELL);
  const parsed = schema.safeParse({
    semesterId: formData.get('semesterId'),
    examDate: formData.get('examDate'),
    ec1Deadline: formData.get('ec1Deadline'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  const existing = await prisma.semester.findUnique({
    where: { id: parsed.data.semesterId },
    select: { id: true, examDate: true, ec1Deadline: true },
  });
  if (!existing) return { error: 'Semester not found' };

  await prisma.semester.update({
    where: { id: parsed.data.semesterId },
    data: {
      examDate: parsed.data.examDate,
      ec1Deadline: parsed.data.ec1Deadline,
    },
  });

  await audit({
    actorId: me.id,
    action: 'semester.dates.updated',
    entity: 'Semester',
    entityId: parsed.data.semesterId,
    before: {
      examDate: existing.examDate?.toISOString() ?? null,
      ec1Deadline: existing.ec1Deadline?.toISOString() ?? null,
    },
    after: {
      examDate: parsed.data.examDate?.toISOString() ?? null,
      ec1Deadline: parsed.data.ec1Deadline?.toISOString() ?? null,
    },
  });

  revalidatePath('/ic/semesters');
  revalidatePath(`/ic/semesters/${parsed.data.semesterId}`);
  revalidatePath('/ic');
  return { ok: true };
}

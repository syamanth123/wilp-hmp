'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma, RoleName, normalizeBitsCourseNumber } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { audit } from '@/lib/audit';

const programmeSchema = z.object({
  code: z.string().min(2).max(20),
  name: z.string().min(2),
});

const courseSchema = z.object({
  code: z.string().min(2).max(20),
  title: z.string().min(2),
  credits: z.coerce.number().int().min(1).max(20).default(3),
});

const semesterSchema = z.object({
  programmeId: z.string().cuid(),
  name: z.string().min(2),
  year: z.coerce.number().int().min(2020).max(2100),
  term: z.enum(['FIRST', 'SECOND', 'SUMMER']),
  startDate: z.string(),
  endDate: z.string(),
});

export async function createProgrammeAction(formData: FormData) {
  const actor = requireRole(await getSessionUser(), RoleName.ADMIN);
  const parsed = programmeSchema.safeParse({
    code: formData.get('code'),
    name: formData.get('name'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const exists = await prisma.programme.findUnique({ where: { code: parsed.data.code } });
  if (exists) return { error: 'Programme code already exists' };
  const created = await prisma.programme.create({ data: parsed.data });
  await audit({
    actorId: actor.id,
    action: 'programme.create',
    entity: 'Programme',
    entityId: created.id,
    after: parsed.data,
  });
  revalidatePath('/admin/programmes');
  return { ok: true };
}

export async function createCourseAction(formData: FormData) {
  const actor = requireRole(await getSessionUser(), RoleName.ADMIN);
  const parsed = courseSchema.safeParse({
    code: formData.get('code'),
    title: formData.get('title'),
    credits: formData.get('credits'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  // Educational rejection — same contract as the CSV importer (Prompt 11b
  // Decision 4). The schema accepts any 2-20 char string; the BITS-format
  // gate is normalizeBitsCourseNumber().
  let canonical: string;
  try {
    canonical = normalizeBitsCourseNumber(parsed.data.code);
  } catch {
    return {
      error:
        `'${parsed.data.code}' is not a valid BITS course number. ` +
        'Expected format: "AE ZG510" (2-4 letter discipline, space, Z[CG], 3-4 digit code).',
    };
  }
  const exists = await prisma.course.findUnique({ where: { bitsCourseNumber: canonical } });
  if (exists) return { error: 'Course code already exists' };
  const created = await prisma.course.create({
    data: {
      bitsCourseNumber: canonical,
      code: canonical,
      title: parsed.data.title,
      credits: parsed.data.credits,
    },
  });
  await audit({
    actorId: actor.id,
    action: 'course.create',
    entity: 'Course',
    entityId: created.id,
    after: {
      bitsCourseNumber: canonical,
      code: canonical,
      title: parsed.data.title,
      credits: parsed.data.credits,
    },
  });
  revalidatePath('/admin/programmes');
  return { ok: true };
}

export async function createSemesterAction(formData: FormData) {
  const actor = requireRole(await getSessionUser(), RoleName.ADMIN);
  const parsed = semesterSchema.safeParse({
    programmeId: formData.get('programmeId'),
    name: formData.get('name'),
    year: formData.get('year'),
    term: formData.get('term'),
    startDate: formData.get('startDate'),
    endDate: formData.get('endDate'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const created = await prisma.semester.create({
    data: {
      ...parsed.data,
      startDate: new Date(parsed.data.startDate),
      endDate: new Date(parsed.data.endDate),
    },
  });
  await audit({
    actorId: actor.id,
    action: 'semester.create',
    entity: 'Semester',
    entityId: created.id,
    after: parsed.data,
  });
  revalidatePath('/admin/programmes');
  return { ok: true };
}

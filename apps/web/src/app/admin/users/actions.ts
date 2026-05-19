'use server';

import { revalidatePath } from 'next/cache';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma, RoleName, FacultyType } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { audit } from '@/lib/audit';

const createSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(6),
  role: z.nativeEnum(RoleName),
  facultyType: z.nativeEnum(FacultyType).optional(),
});

export async function createUserAction(formData: FormData) {
  const actor = requireRole(await getSessionUser(), RoleName.ADMIN);
  const parsed = createSchema.safeParse({
    email: formData.get('email'),
    name: formData.get('name'),
    password: formData.get('password'),
    role: formData.get('role'),
    facultyType: formData.get('facultyType') || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }
  const { email, name, password, role, facultyType } = parsed.data;
  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) return { error: 'User with that email already exists' };

  const passwordHash = await bcrypt.hash(password, 10);
  const roleRecord = await prisma.role.findUniqueOrThrow({ where: { name: role } });
  const user = await prisma.user.create({
    data: {
      email,
      name,
      passwordHash,
      facultyType: facultyType ?? null,
      roles: { create: [{ roleId: roleRecord.id }] },
    },
  });
  await audit({
    actorId: actor.id,
    action: 'user.create',
    entity: 'User',
    entityId: user.id,
    after: { email, name, role, facultyType },
  });
  revalidatePath('/admin/users');
  return { ok: true };
}

export async function toggleUserActiveAction(userId: string) {
  const actor = requireRole(await getSessionUser(), RoleName.ADMIN);
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { active: !u.active },
  });
  await audit({
    actorId: actor.id,
    action: u.active ? 'user.deactivate' : 'user.activate',
    entity: 'User',
    entityId: userId,
    before: { active: u.active },
    after: { active: updated.active },
  });
  revalidatePath('/admin/users');
}

'use server';

import { revalidatePath } from 'next/cache';
import { prisma, RoleName, type Prisma } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { loadDibbaCodeRows } from '@/lib/dibba-programme-codes';
import {
  departmentOfDibbaCode,
  loadDepartmentLinks,
  suggestDepartmentForTitle,
} from '@/lib/departments';

/**
 * Admin → Departments (v1.4.0, docs/plans/departments.md §A): the departments themselves, and which
 * department each HMP programme and Course Dibba programme code belongs to. Admin only; every change
 * is audit-logged. Title suggestions are applied only when the Admin clicks.
 */

type Result = { ok: true; changed?: number } | { ok: false; error: string };

const admin = async () => requireRole(await getSessionUser(), RoleName.ADMIN);
const done = (r: Result) => {
  revalidatePath('/admin/departments');
  revalidatePath('/admin/people');
  revalidatePath('/admin');
  return r;
};
const audit = (
  tx: Prisma.TransactionClient | typeof prisma,
  actorId: string,
  action: string,
  entity: string,
  entityId: string,
  after: Record<string, unknown>,
) =>
  tx.auditLog.create({
    data: { actorId, action, entity, entityId, after: after as Prisma.InputJsonValue },
  });

const CODE = /^[A-Z][A-Z0-9_-]{1,15}$/;

export async function saveDepartmentAction(input: {
  id?: string;
  code: string;
  name: string;
  active: boolean;
}): Promise<Result> {
  const actor = await admin();
  const code = input.code.trim().toUpperCase();
  const name = input.name.trim();
  if (!CODE.test(code)) return { ok: false, error: 'Code: 2–16 letters or digits, e.g. CSIS.' };
  if (name.length < 2 || name.length > 80)
    return { ok: false, error: 'Type the department’s name.' };
  const clash = await prisma.department.findFirst({
    where: {
      OR: [{ code }, { name: { equals: name, mode: 'insensitive' } }],
      ...(input.id ? { NOT: { id: input.id } } : {}),
    },
    select: { code: true },
  });
  if (clash) return { ok: false, error: `${clash.code} already has that code or name.` };
  if (input.id && !input.active) {
    const members = await prisma.user.count({ where: { departmentId: input.id, active: true } });
    if (members)
      return {
        ok: false,
        error: `${members} active ${members === 1 ? 'person is' : 'people are'} in this department — move them first (Admin → People).`,
      };
  }
  const saved = input.id
    ? await prisma.department.update({
        where: { id: input.id },
        data: { code, name, active: input.active },
      })
    : await prisma.department.create({ data: { code, name, active: true } });
  await audit(
    prisma,
    actor.id,
    input.id ? 'department.update' : 'department.create',
    'Department',
    saved.id,
    {
      code,
      name,
      active: saved.active,
    },
  );
  return done({ ok: true });
}

async function activeDepartment(id: string | null) {
  if (!id) return null;
  return prisma.department.findFirst({
    where: { id, active: true },
    select: { id: true, name: true },
  });
}

export async function setProgrammeDepartmentAction(
  programmeId: string,
  departmentId: string | null,
): Promise<Result> {
  const actor = await admin();
  const dept = await activeDepartment(departmentId);
  if (departmentId && !dept) return { ok: false, error: 'That department is not active.' };
  const p = await prisma.programme.findUnique({
    where: { id: programmeId },
    select: { code: true },
  });
  if (!p) return { ok: false, error: 'That programme no longer exists.' };
  await prisma.programme.update({
    where: { id: programmeId },
    data: { departmentId: dept?.id ?? null },
  });
  await audit(prisma, actor.id, 'programme.department', 'Programme', programmeId, {
    programme: p.code,
    department: dept?.name ?? null,
  });
  return done({ ok: true });
}

export async function setDibbaCodeDepartmentAction(
  code: string,
  departmentId: string | null,
): Promise<Result> {
  const actor = await admin();
  const dept = await activeDepartment(departmentId);
  if (departmentId && !dept) return { ok: false, error: 'That department is not active.' };
  const known = await prisma.dibbaEntry.findFirst({
    where: { programmeCode: code },
    select: { id: true },
  });
  if (!known) return { ok: false, error: 'No Course Dibba has that programme code.' };
  if (dept)
    await prisma.dibbaProgrammeDepartment.upsert({
      where: { code },
      update: { departmentId: dept.id, updatedById: actor.id },
      create: { code, departmentId: dept.id, updatedById: actor.id },
    });
  else await prisma.dibbaProgrammeDepartment.deleteMany({ where: { code } });
  await audit(prisma, actor.id, 'dibba-code.department', 'DibbaProgrammeDepartment', code, {
    code,
    department: dept?.name ?? null,
  });
  return done({ ok: true });
}

/** Tag every Dibba code that has no department yet with the department its title points to. */
export async function acceptDibbaTitleSuggestionsAction(): Promise<Result> {
  const actor = await admin();
  const [rows, links, departments] = await Promise.all([
    loadDibbaCodeRows(),
    loadDepartmentLinks(),
    prisma.department.findMany({
      where: { active: true },
      select: { id: true, code: true, name: true },
    }),
  ]);
  const todo = rows.flatMap((r) => {
    if (departmentOfDibbaCode(r.code, links)) return [];
    const s = suggestDepartmentForTitle(r.title, departments);
    return s ? [{ code: r.code, dept: s }] : [];
  });
  await prisma.$transaction(async (tx) => {
    for (const t of todo) {
      await tx.dibbaProgrammeDepartment.upsert({
        where: { code: t.code },
        update: { departmentId: t.dept.id, updatedById: actor.id },
        create: { code: t.code, departmentId: t.dept.id, updatedById: actor.id },
      });
      await audit(tx, actor.id, 'dibba-code.department', 'DibbaProgrammeDepartment', t.code, {
        code: t.code,
        department: t.dept.name,
        source: 'title suggestion, accepted by Admin',
      });
    }
  });
  return done({ ok: true, changed: todo.length });
}

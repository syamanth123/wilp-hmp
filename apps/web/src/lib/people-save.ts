import { prisma, NotificationChannel, RoleName, type FacultyType, type Prisma } from '@hmp/db';
import { deliver } from './notifications';
import {
  impactOfChange,
  openWork,
  loads,
  loadText,
  type OpenWorkItem,
  type WorkRole,
} from './people';

/**
 * Saving a person (v1.4 §B, §B2): one department, any roles. Before a change that would leave open
 * work without an owner (a role taken away, a department change for HOG/PC work, deactivation), the
 * caller must name a replacement for every affected item; the change and the reassignments happen
 * in one transaction, audit-logged. `accessVersion` is bumped so the person's open session picks up
 * the new access on the next page.
 */

export const DEPARTMENT_ROLES: RoleName[] = [
  RoleName.HOG,
  RoleName.PROGRAMME_COMMITTEE,
  RoleName.FACULTY,
  RoleName.SME,
];

const WORK_ROLE: Record<WorkRole, RoleName> = {
  HOG: RoleName.HOG,
  PC: RoleName.PROGRAMME_COMMITTEE,
  FACULTY: RoleName.FACULTY,
  SME: RoleName.SME,
};

export interface PersonInput {
  id?: string;
  name: string;
  email: string;
  roles: RoleName[];
  departmentId: string | null;
  facultyType: FacultyType | null;
  active: boolean;
  /** `${requestId}:${role}` → the person taking that item over. */
  replacements?: Record<string, string>;
}

export interface Candidate {
  id: string;
  name: string;
  department: string | null;
  sameDepartment: boolean;
  load: string;
}

export type SaveResult =
  | { ok: true; id: string }
  | { ok: false; error: string }
  | {
      ok: false;
      needsReplacements: true;
      items: (OpenWorkItem & { key: string })[];
      candidates: Partial<Record<WorkRole, Candidate[]>>;
    };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function validatePerson(p: PersonInput): Promise<string | null> {
  if (!p.name.trim()) return 'Type the person’s name.';
  if (!EMAIL.test(p.email.trim())) return 'Type a valid email address (their BITS email).';
  if (p.roles.length === 0) return 'Tick at least one role.';
  const needsDept = p.roles.some((r) => DEPARTMENT_ROLES.includes(r));
  if (needsDept && !p.departmentId)
    return 'HOG, PC, faculty and SME belong to a department — pick one.';
  const email = p.email.trim().toLowerCase();
  const clash = await prisma.user.findFirst({
    where: {
      email: { equals: email, mode: 'insensitive' },
      ...(p.id ? { NOT: { id: p.id } } : {}),
    },
    select: { id: true },
  });
  if (clash) return 'Someone else already has that email.';
  if (p.roles.includes(RoleName.HOG) && p.active && p.departmentId) {
    const other = await prisma.user.findFirst({
      where: {
        departmentId: p.departmentId,
        active: true,
        roles: { some: { role: { name: RoleName.HOG } } },
        ...(p.id ? { NOT: { id: p.id } } : {}),
      },
      select: { name: true, department: { select: { name: true } } },
    });
    if (other)
      return `${other.department?.name} already has a HOG (${other.name}). A department has one HOG — change ${other.name} first.`;
  }
  if (p.id && !p.roles.includes(RoleName.ADMIN)) {
    const wasAdmin = await prisma.userRole.findFirst({
      where: { userId: p.id, role: { name: RoleName.ADMIN } },
    });
    const admins = await prisma.user.count({
      where: { active: true, roles: { some: { role: { name: RoleName.ADMIN } } } },
    });
    if (wasAdmin && admins <= 1) return 'This is the last Admin — keep the Admin role.';
  }
  return null;
}

async function candidatesFor(role: WorkRole, departmentId: string | null, exclude: string) {
  const people = await prisma.user.findMany({
    where: {
      active: true,
      NOT: { id: exclude },
      roles: { some: { role: { name: WORK_ROLE[role] } } },
    },
    select: { id: true, name: true, departmentId: true, department: { select: { name: true } } },
    orderBy: { name: 'asc' },
  });
  const load = await loads(people.map((p) => p.id));
  return people
    .map((p) => ({
      id: p.id,
      name: p.name,
      department: p.department?.name ?? null,
      sameDepartment: !!departmentId && p.departmentId === departmentId,
      load: loadText(load.get(p.id)),
    }))
    .sort(
      (a, b) => Number(b.sameDepartment) - Number(a.sameDepartment) || a.name.localeCompare(b.name),
    );
}

export async function savePerson(actorId: string, p: PersonInput): Promise<SaveResult> {
  const problem = await validatePerson(p);
  if (problem) return { ok: false, error: problem };
  const email = p.email.trim().toLowerCase();
  const roleRows = await prisma.role.findMany({ where: { name: { in: p.roles } } });

  const before = p.id
    ? await prisma.user.findUnique({
        where: { id: p.id },
        select: {
          name: true,
          email: true,
          active: true,
          departmentId: true,
          facultyType: true,
          roles: { select: { role: { select: { name: true } } } },
        },
      })
    : null;
  if (p.id && !before) return { ok: false, error: 'That person no longer exists.' };

  let affected: OpenWorkItem[] = [];
  if (p.id && before) {
    const removedRoles = before.roles.map((r) => r.role.name).filter((r) => !p.roles.includes(r));
    affected = impactOfChange((await openWork([p.id])).get(p.id) ?? [], {
      removedRoles,
      departmentChanged: before.departmentId !== p.departmentId,
      deactivated: before.active && !p.active,
    });
    const missing = affected.filter((i) => !p.replacements?.[`${i.requestId}:${i.role}`]);
    if (missing.length) {
      const roles = [...new Set(affected.map((i) => i.role))];
      const candidates: Partial<Record<WorkRole, Candidate[]>> = {};
      for (const r of roles)
        candidates[r] = await candidatesFor(r, p.departmentId ?? before.departmentId, p.id);
      return {
        ok: false,
        needsReplacements: true,
        items: affected.map((i) => ({ ...i, key: `${i.requestId}:${i.role}` })),
        candidates,
      };
    }
  }

  const id = await prisma.$transaction(async (tx) => {
    const data = {
      name: p.name.trim(),
      email,
      departmentId: p.departmentId,
      facultyType: p.facultyType,
      active: p.active,
    };
    const user = p.id
      ? await tx.user.update({
          where: { id: p.id },
          data: { ...data, accessVersion: { increment: 1 } },
        })
      : await tx.user.create({ data });
    await tx.userRole.deleteMany({
      where: { userId: user.id, roleId: { notIn: roleRows.map((r) => r.id) } },
    });
    for (const r of roleRows)
      await tx.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId: r.id } },
        update: {},
        create: { userId: user.id, roleId: r.id },
      });

    for (const item of affected) {
      const to = p.replacements![`${item.requestId}:${item.role}`]!;
      await reassign(tx, {
        item,
        fromUserId: user.id,
        toUserId: to,
        actorId,
        reason: 'Roles or department changed',
      });
    }

    await tx.auditLog.create({
      data: {
        actorId,
        action: p.id ? 'user.update' : 'user.create',
        entity: 'User',
        entityId: user.id,
        before: before
          ? ({ ...before, roles: before.roles.map((r) => r.role.name) } as Prisma.InputJsonValue)
          : undefined,
        after: { ...data, roles: p.roles, reassigned: affected.length } as Prisma.InputJsonValue,
      },
    });
    return user.id;
  });
  // v1.4.2 (F13): a person switched off is no longer anyone's back-up; those still away are told to pick another.
  if (before?.active && !p.active) await dropAsBackup(id, before.name);
  return { ok: true, id };
}

async function dropAsBackup(userId: string, name: string) {
  const covering = await prisma.userPreference.findMany({
    where: { backupUserId: userId },
    select: { userId: true, user: { select: { email: true } } },
  });
  if (covering.length === 0) return;
  await prisma.userPreference.updateMany({
    where: { backupUserId: userId },
    data: { backupUserId: null },
  });
  for (const c of covering)
    await deliver({
      userId: c.userId,
      email: c.user.email,
      role: RoleName.FACULTY,
      subject: `${name} can no longer be your back-up`,
      body: `${name}'s account was switched off, so they are no longer your back-up while you are away. Pick another in My settings.`,
      link: '/settings',
      channels: [NotificationChannel.IN_PORTAL, NotificationChannel.EMAIL],
      metaKind: 'user.backup-removed',
      urgent: true,
    });
}

/** Moves one open item from one person to another (history kept), audit-logged. */
export async function reassign(
  tx: Prisma.TransactionClient,
  a: { item: OpenWorkItem; fromUserId: string; toUserId: string; actorId: string; reason: string },
) {
  const { item } = a;
  if (item.role === 'FACULTY') {
    const old = await tx.facultyAssignment.findFirst({
      where: { requestId: item.requestId, facultyId: a.fromUserId, active: true },
    });
    const to = await tx.user.findUniqueOrThrow({
      where: { id: a.toUserId },
      select: { facultyType: true },
    });
    if (old) await tx.facultyAssignment.update({ where: { id: old.id }, data: { active: false } });
    await tx.facultyAssignment.create({
      data: {
        requestId: item.requestId,
        facultyId: a.toUserId,
        facultyType: to.facultyType ?? old?.facultyType ?? 'ON_CAMPUS',
        active: true,
        acceptedAt: old?.acceptedAt ?? null,
      },
    });
  } else if (item.role === 'SME') {
    await tx.smeAssignment.update({
      where: { requestId: item.requestId },
      data: { smeUserId: a.toUserId },
    });
  }
  const role = {
    HOG: RoleName.HOG,
    PC: RoleName.PROGRAMME_COMMITTEE,
    FACULTY: RoleName.FACULTY,
    SME: RoleName.SME,
  }[item.role];
  await tx.requestAssignee.updateMany({
    where: { requestId: item.requestId, role, userId: a.fromUserId, endedAt: null },
    data: { endedAt: new Date(), reason: a.reason },
  });
  await tx.requestAssignee.create({
    data: {
      requestId: item.requestId,
      role,
      userId: a.toUserId,
      assignedById: a.actorId,
      reason: a.reason,
    },
  });
  await tx.auditLog.create({
    data: {
      actorId: a.actorId,
      action: 'request.reassign',
      entity: 'HandoutRequest',
      entityId: item.requestId,
      requestId: item.requestId,
      before: { role: item.role, userId: a.fromUserId } as Prisma.InputJsonValue,
      after: { role: item.role, userId: a.toUserId, reason: a.reason } as Prisma.InputJsonValue,
    },
  });
}

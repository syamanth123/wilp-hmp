import type { RoleName} from '@hmp/db';
import { prisma, type FacultyType } from '@hmp/db';
import { savePerson } from './people-save';
import { adminOnlyProblem } from './people-rules';
import { roleLabel } from './labels';
import { formatDateTime } from './format-date';

/**
 * v1.4.2 — undo the latest role / department change of a person within 24 hours (docs/plans/v1.4.2-workload.md
 * §8.2, H24). Undo puts back roles, department, faculty type and active, through the same save (so the same
 * checks apply: one HOG per department, last Admin, open work). Work handed over in that change stays with
 * the new person. Only the latest change can be undone, and an undo can't itself be undone.
 */

export const UNDO_HOURS = 24;

interface Snapshot {
  roles: RoleName[];
  departmentId: string | null;
  facultyType: FacultyType | null;
  active: boolean;
}

const asSnapshot = (j: unknown): Snapshot | null => {
  const o = j as Partial<Snapshot> | null;
  if (!o || !Array.isArray(o.roles) || typeof o.active !== 'boolean') return null;
  return {
    roles: o.roles as RoleName[],
    departmentId: (o.departmentId as string | null) ?? null,
    facultyType: (o.facultyType as FacultyType | null) ?? null,
    active: o.active,
  };
};

export interface Undoable {
  auditId: string;
  at: Date;
  atText: string;
  untilText: string;
  actorName: string;
  changes: string[];
  handedOver: number;
  before: Snapshot;
}

export async function lastUndoable(
  userId: string,
  now: Date = new Date(),
): Promise<Undoable | null> {
  const latest = await prisma.auditLog.findFirst({
    where: { entity: 'User', entityId: userId, action: { in: ['user.update', 'user.undo'] } },
    orderBy: { createdAt: 'desc' },
    include: { actor: { select: { name: true } } },
  });
  if (!latest || latest.action !== 'user.update') return null;
  if (now.getTime() - latest.createdAt.getTime() > UNDO_HOURS * 3_600_000) return null;
  const before = asSnapshot(latest.before);
  const after = asSnapshot(latest.after);
  if (!before || !after) return null;

  const depts = new Map(
    (await prisma.department.findMany({ select: { id: true, name: true } })).map((d) => [
      d.id,
      d.name,
    ]),
  );
  const dept = (id: string | null) => (id ? (depts.get(id) ?? 'another department') : 'none');
  const roles = (rs: RoleName[]) => rs.map((r) => roleLabel(r)).join(', ') || 'none';
  const changes: string[] = [];
  const same = (a: RoleName[], b: RoleName[]) => [...a].sort().join() === [...b].sort().join();
  if (!same(before.roles, after.roles))
    changes.push(`Roles: ${roles(before.roles)} → ${roles(after.roles)}`);
  if (before.departmentId !== after.departmentId)
    changes.push(`Department: ${dept(before.departmentId)} → ${dept(after.departmentId)}`);
  if (before.facultyType !== after.facultyType) changes.push('Faculty type changed');
  if (before.active !== after.active) changes.push(after.active ? 'Switched on' : 'Switched off');
  if (changes.length === 0) return null; // a name / email edit: nothing to undo here

  const until = new Date(latest.createdAt.getTime() + UNDO_HOURS * 3_600_000);
  return {
    auditId: latest.id,
    at: latest.createdAt,
    atText: formatDateTime(latest.createdAt),
    untilText: formatDateTime(until),
    actorName: latest.actor?.name ?? 'someone',
    changes,
    handedOver: Number((latest.after as { reassigned?: number } | null)?.reassigned ?? 0),
    before,
  };
}

export type UndoResult = { ok: true } | { ok: false; error: string };

export async function undoPersonChange(
  actor: { id: string; isAdmin: boolean },
  userId: string,
  auditId: string,
): Promise<UndoResult> {
  const u = await lastUndoable(userId);
  if (!u || u.auditId !== auditId)
    return {
      ok: false,
      error: 'This change can no longer be undone (more than 24 hours, or changed again since).',
    };
  const current = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true, roles: { select: { role: { select: { name: true } } } } },
  });
  if (!current) return { ok: false, error: 'That person no longer exists.' };
  const notYours = adminOnlyProblem(
    actor.isAdmin,
    current.roles.map((r) => r.role.name),
    u.before.roles,
  );
  if (notYours) return { ok: false, error: notYours };

  const r = await savePerson(actor.id, {
    id: userId,
    name: current.name,
    email: current.email,
    roles: u.before.roles,
    departmentId: u.before.departmentId,
    facultyType: u.before.facultyType,
    active: u.before.active,
  });
  if (!r.ok) {
    if ('needsReplacements' in r)
      return {
        ok: false,
        error: `Undo would leave ${r.items.length} open handout${r.items.length === 1 ? '' : 's'} without an owner — make the change on this page instead, choosing who takes them over.`,
      };
    return { ok: false, error: r.error };
  }
  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      action: 'user.undo',
      entity: 'User',
      entityId: userId,
      after: { undid: auditId },
    },
  });
  return { ok: true };
}

import { prisma, type RoleName } from '@hmp/db';
import { formatDueDay, istDay } from './deadlines';

/**
 * v1.4.2 — away and back-up (docs/plans/v1.4.2-workload.md §4, H18). A person is away from `awayFrom`
 * (or now, when empty) through the whole of `awayUntil` (India time). While away, their back-up sees,
 * is told about and can act on their requests; nothing is reassigned.
 */

export interface AwayWindow {
  awayFrom: Date | null;
  awayUntil: Date | null;
}

export function isAway(p: AwayWindow | null | undefined, now: Date = new Date()): boolean {
  if (!p?.awayUntil) return false;
  if (p.awayFrom && istDay(p.awayFrom) > istDay(now)) return false;
  return istDay(p.awayUntil) >= istDay(now);
}

export interface AwayInfo {
  until: Date;
  untilText: string;
  backupId: string | null;
  backupName: string | null;
}

/** Who among `userIds` is away now, with their back-up — for pickers ("away until 20 Nov · back-up Dr Y"). */
export async function awayByUser(
  userIds: string[],
  now: Date = new Date(),
): Promise<Map<string, AwayInfo>> {
  const out = new Map<string, AwayInfo>();
  if (userIds.length === 0) return out;
  const prefs = await prisma.userPreference.findMany({
    where: { userId: { in: userIds }, awayUntil: { not: null } },
    select: {
      userId: true,
      awayFrom: true,
      awayUntil: true,
      backupUser: { select: { id: true, name: true } },
    },
  });
  for (const p of prefs) {
    if (!isAway(p, now) || !p.awayUntil) continue;
    out.set(p.userId, {
      until: p.awayUntil,
      untilText: formatDueDay(p.awayUntil),
      backupId: p.backupUser?.id ?? null,
      backupName: p.backupUser?.name ?? null,
    });
  }
  return out;
}

export function awayText(a: AwayInfo | undefined): string | null {
  if (!a) return null;
  return a.backupName
    ? `away until ${a.untilText} · back-up ${a.backupName}`
    : `away until ${a.untilText}`;
}

/** The away colleagues `userId` is back-up for right now. */
export async function awayPeopleBackedUpBy(
  userId: string,
  now: Date = new Date(),
): Promise<
  { id: string; name: string; roles: RoleName[]; departmentId: string | null; until: Date }[]
> {
  const prefs = await prisma.userPreference.findMany({
    where: { backupUserId: userId, awayUntil: { not: null } },
    select: {
      awayFrom: true,
      awayUntil: true,
      user: {
        select: {
          id: true,
          name: true,
          active: true,
          departmentId: true,
          roles: { select: { role: { select: { name: true } } } },
        },
      },
    },
  });
  return prefs
    .filter((p) => p.user.active && isAway(p, now))
    .map((p) => ({
      id: p.user.id,
      name: p.user.name,
      roles: p.user.roles.map((r) => r.role.name),
      departmentId: p.user.departmentId,
      until: p.awayUntil!,
    }));
}

/** Roles whose work a back-up can look after (H18). Faculty can be away, but nobody writes their draft. */
export const BACKUP_ROLES: RoleName[] = ['HOG', 'PROGRAMME_COMMITTEE', 'SME', 'INSTRUCTION_CELL'];

/** Colleagues who can be `userId`'s back-up: active, sharing one of their back-up roles; own department first. */
export async function backupCandidates(user: {
  id: string;
  roles: RoleName[];
  departmentId?: string | null;
}) {
  const roles = user.roles.filter((r) => BACKUP_ROLES.includes(r));
  if (roles.length === 0) return [];
  const people = await prisma.user.findMany({
    where: {
      id: { not: user.id },
      active: true,
      roles: { some: { role: { name: { in: roles } } } },
    },
    select: {
      id: true,
      name: true,
      departmentId: true,
      department: { select: { name: true } },
      roles: { select: { role: { select: { name: true } } } },
    },
    orderBy: { name: 'asc' },
  });
  const away = await awayByUser(people.map((p) => p.id));
  return people
    .map((p) => ({
      id: p.id,
      name: p.name,
      department: p.department?.name ?? null,
      sameDepartment: !!user.departmentId && p.departmentId === user.departmentId,
      roles: p.roles.map((r) => r.role.name).filter((r) => roles.includes(r)),
      away: awayText(away.get(p.id)),
    }))
    .sort(
      (a, b) => Number(b.sameDepartment) - Number(a.sameDepartment) || a.name.localeCompare(b.name),
    );
}

import { prisma, RoleName, type Prisma } from '@hmp/db';
import { awayPeopleBackedUpBy, BACKUP_ROLES } from './away';
import { departmentScope, type DeptScopeUser } from './department-scope';

/**
 * v1.4.2 — a back-up acting for an away colleague (docs/plans/v1.4.2-workload.md §4, H18). While the person
 * is away, their back-up sees and can act on the requests the person could, in the roles both hold (never
 * faculty writing). Nothing is reassigned; the action is recorded "for <name>".
 */

export interface CoveredPerson {
  id: string;
  name: string;
  scopeUser: DeptScopeUser;
}

/** The away colleagues `user` backs up today, each with the roles the back-up may cover. */
export async function coveredPeople(
  user: DeptScopeUser,
  now: Date = new Date(),
): Promise<CoveredPerson[]> {
  const away = await awayPeopleBackedUpBy(user.id, now);
  return away
    .map((a) => ({
      id: a.id,
      name: a.name,
      scopeUser: {
        id: a.id,
        departmentId: a.departmentId,
        roles: a.roles.filter((r) => BACKUP_ROLES.includes(r) && user.roles.includes(r)),
      },
    }))
    .filter((c) => c.scopeUser.roles.length > 0);
}

/** Requests the person is on, in the given roles (their scope as HOG / PC, or named as SME / IC). */
function reachOf(u: DeptScopeUser): Prisma.HandoutRequestWhereInput[] {
  const or: Prisma.HandoutRequestWhereInput[] = [];
  if (u.roles.includes(RoleName.INSTRUCTION_CELL)) or.push({});
  if (u.roles.includes(RoleName.HOG) || u.roles.includes(RoleName.PROGRAMME_COMMITTEE))
    or.push(departmentScope(u) ?? {});
  if (u.roles.includes(RoleName.SME)) or.push({ smeAssignment: { smeUserId: u.id } });
  return or;
}

/** Can `user` reach this request as the back-up of someone away? Returns that person, or null. */
export async function coveringFor(
  user: DeptScopeUser,
  requestId: string,
  now: Date = new Date(),
): Promise<{ id: string; name: string } | null> {
  for (const c of await coveredPeople(user, now)) {
    const or = reachOf(c.scopeUser);
    if (!or.length) continue;
    const n = await prisma.handoutRequest.count({
      where: { AND: [{ id: requestId }, { OR: or }] },
    });
    if (n > 0) return { id: c.id, name: c.name };
  }
  return null;
}

/**
 * The away person this action is done for, if `user` acts as their back-up on this request: the request names
 * that person (HOG / PC / SME), or the user reaches it only through them. For the audit ("for Dr X").
 */
export async function actingFor(
  user: DeptScopeUser,
  requestId: string,
): Promise<{ id: string; name: string } | null> {
  const covered = await coveredPeople(user);
  if (covered.length === 0) return null;
  const ids = covered.map((c) => c.id);
  const named = await prisma.requestAssignee.findFirst({
    where: { requestId, endedAt: null, userId: { in: ids } },
    select: { userId: true },
  });
  const sme = await prisma.smeAssignment.findFirst({
    where: { requestId, smeUserId: { in: ids } },
    select: { smeUserId: true },
  });
  const who = named?.userId ?? sme?.smeUserId;
  if (who) {
    const c = covered.find((x) => x.id === who);
    return c ? { id: c.id, name: c.name } : null;
  }
  const own = departmentScope(user);
  if (own) {
    const mine = await prisma.handoutRequest.count({ where: { AND: [{ id: requestId }, own] } });
    if (mine > 0) return null;
  }
  return coveringFor(user, requestId);
}

/** For transition({ meta }): "for <name>" when the actor acts as someone's back-up (shown in the history). */
export async function onBehalfMeta(
  user: DeptScopeUser,
  requestId: string,
): Promise<Record<string, unknown> | undefined> {
  const who = await actingFor(user, requestId);
  return who ? { onBehalfOf: who.id, onBehalfOfName: who.name } : undefined;
}

/** Is `actorId` today's back-up of `personId` (who is away)? */
export async function isBackupOf(
  actorId: string,
  personId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const away = await awayPeopleBackedUpBy(actorId, now);
  return away.some((a) => a.id === personId);
}

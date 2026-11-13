import { prisma, HandoutStatus, NotificationChannel, RoleName } from '@hmp/db';
import { deliver, linkFor } from './notifications';
import { loadMailContext } from './email/context';
import { handoverEmail } from './email/other';
import { loadRequestFacts } from './email/request-facts';
import { reassign } from './people-save';
import { loads, loadText } from './people';

/**
 * v1.4.1 §A4 — change a request's HOG (by the IC) or its PC (by the HOG), with a reason. The old row is
 * ended and kept (history), the audit log records it ("Handed the work over to someone else"), and both
 * the old and the new person are told. Faculty / SME changes stay as before.
 */

export type HandoverRole = 'HOG' | 'PC';
const ROLE: Record<HandoverRole, RoleName> = {
  HOG: RoleName.HOG,
  PC: RoleName.PROGRAMME_COMMITTEE,
};
const WORD: Record<HandoverRole, string> = {
  HOG: 'Head of Group',
  PC: 'Programme Committee member',
};

/** Statuses in which nobody needs a HOG / PC any more. */
const CLOSED: HandoutStatus[] = [
  HandoutStatus.PUBLISHED,
  HandoutStatus.ARCHIVED,
  HandoutStatus.REJECTED,
];

export async function currentAssignee(requestId: string, role: HandoverRole) {
  return prisma.requestAssignee.findFirst({
    where: { requestId, role: ROLE[role], endedAt: null },
    orderBy: { assignedAt: 'desc' },
    select: { userId: true, user: { select: { id: true, name: true, email: true } } },
  });
}

export async function changeHogOrPc(input: {
  requestId: string;
  role: HandoverRole;
  toUserId: string;
  reason: string;
  actor: { id: string; name: string };
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const reason = input.reason.trim();
  if (reason.length < 5) return { ok: false, error: 'Say why (a few words).' };
  if (reason.length > 500) return { ok: false, error: 'Keep the reason under 500 characters.' };

  const request = await prisma.handoutRequest.findUnique({
    where: { id: input.requestId },
    select: {
      id: true,
      refNo: true,
      status: true,
      offering: { select: { course: { select: { code: true, title: true } } } },
    },
  });
  if (!request) return { ok: false, error: 'That request no longer exists.' };
  if (CLOSED.includes(request.status))
    return { ok: false, error: 'This request is finished — nothing to hand over.' };

  const to = await prisma.user.findFirst({
    where: {
      id: input.toUserId,
      active: true,
      roles: { some: { role: { name: ROLE[input.role] } } },
    },
    select: { id: true, name: true, email: true },
  });
  if (!to) return { ok: false, error: `Choose an active ${WORD[input.role]}.` };

  const from = await currentAssignee(request.id, input.role);
  if (from?.userId === to.id)
    return { ok: false, error: `${to.name} is already the ${input.role}.` };

  await prisma.$transaction(async (tx) => {
    if (from) {
      await reassign(tx, {
        item: {
          requestId: request.id,
          refNo: request.refNo,
          course: request.offering.course.code,
          status: request.status,
          role: input.role,
          overdue: false,
          dueThisWeek: false,
        },
        fromUserId: from.userId,
        toUserId: to.id,
        actorId: input.actor.id,
        reason,
      });
    } else {
      // Older requests (before v1.4.1) may have none recorded yet.
      await tx.requestAssignee.create({
        data: {
          requestId: request.id,
          role: ROLE[input.role],
          userId: to.id,
          assignedById: input.actor.id,
          reason,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: input.actor.id,
          action: 'request.reassign',
          entity: 'HandoutRequest',
          entityId: request.id,
          requestId: request.id,
          after: { role: input.role, userId: to.id, reason },
        },
      });
    }
  });

  const course = `${request.offering.course.code} ${request.offering.course.title}`;
  // v1.4.3: the full email — by whom, from whom, to whom, the reason, with the request's details.
  const [facts, ctx] = await Promise.all([
    loadRequestFacts(request.id),
    loadMailContext(input.actor.name),
  ]);
  const tell = (
    u: { id: string; email: string; name: string },
    subject: string,
    body: string,
    isNew: boolean,
  ): Promise<unknown> =>
    deliver({
      mail: facts
        ? handoverEmail(
            facts,
            { id: u.id, name: u.name, email: u.email, role: ROLE[input.role] },
            {
              isNew,
              role: WORD[input.role],
              from: from?.user.name ?? null,
              toName: to.name,
              reason,
            },
            ctx,
          )
        : null,
      userId: u.id,
      email: u.email,
      role: ROLE[input.role],
      subject,
      body,
      link: linkFor(ROLE[input.role], request.id),
      channels: [NotificationChannel.IN_PORTAL, NotificationChannel.EMAIL],
      metaKind: 'request.reassign',
      extraMeta: { requestId: request.id, refNo: request.refNo, role: input.role },
    });
  await Promise.allSettled([
    tell(
      to,
      `You are now the ${input.role} for ${request.refNo}`,
      `${input.actor.name} made you the ${WORD[input.role]} for ${request.refNo} (${course})${from ? `, taking over from ${from.user.name}` : ''}. Reason: ${reason}`,
      true,
    ),
    ...(from && from.userId !== input.actor.id
      ? [
          tell(
            from.user,
            `${request.refNo} has moved to ${to.name}`,
            `${input.actor.name} handed ${request.refNo} (${course}) over to ${to.name} as ${WORD[input.role]}. Reason: ${reason}`,
            false,
          ),
        ]
      : []),
  ]);
  return { ok: true };
}

/** Everyone who could take the role over: active, with load; the request's department first. */
export async function handoverCandidates(
  role: HandoverRole,
  departmentId: string | null,
): Promise<
  {
    id: string;
    name: string;
    departmentName: string | null;
    load: string;
    sameDepartment: boolean;
  }[]
> {
  const people = await prisma.user.findMany({
    where: { active: true, roles: { some: { role: { name: ROLE[role] } } } },
    select: { id: true, name: true, departmentId: true, department: { select: { name: true } } },
    orderBy: { name: 'asc' },
  });
  const load = await loads(people.map((p) => p.id));
  return people
    .map((p) => ({
      id: p.id,
      name: p.name,
      departmentName: p.department?.name ?? null,
      load: loadText(load.get(p.id)),
      sameDepartment: !!departmentId && p.departmentId === departmentId,
    }))
    .sort(
      (a, b) => Number(b.sameDepartment) - Number(a.sameDepartment) || a.name.localeCompare(b.name),
    );
}

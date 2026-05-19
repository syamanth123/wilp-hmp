import {
  prisma,
  NotificationChannel,
  NotificationStatus,
  RoleName,
  type HandoutRequest,
} from '@hmp/db';
import { sendMail } from '@hmp/integrations';

export type WorkflowEventType =
  | 'REQUEST_INITIATED'
  | 'FACULTY_ALLOCATED'
  | 'ASSIGNED'
  | 'EDIT_STARTED'
  | 'SUBMITTED'
  | 'REVIEW_REWORK'
  | 'REVIEW_APPROVED'
  | 'FINAL_APPROVED'
  | 'FINAL_REJECTED'
  | 'PUBLISHED'
  | 'ARCHIVED';

interface ActorRef {
  id: string;
  name: string;
}

export const EVENT_TEMPLATE_KEY: Record<WorkflowEventType, string | null> = {
  REQUEST_INITIATED: 'handout.requested',
  FACULTY_ALLOCATED: 'handout.allocated',
  ASSIGNED: 'handout.assigned',
  EDIT_STARTED: null,
  SUBMITTED: 'handout.submitted',
  REVIEW_REWORK: 'handout.rework',
  REVIEW_APPROVED: 'handout.review_approved',
  FINAL_APPROVED: 'handout.approved',
  FINAL_REJECTED: 'handout.rejected',
  PUBLISHED: 'handout.published',
  ARCHIVED: null,
};

const INLINE_FALLBACK: Record<WorkflowEventType, { subject: string; body: string }> = {
  REQUEST_INITIATED: { subject: 'New handout request {{refNo}}', body: 'A new handout request {{refNo}} has been initiated.' },
  FACULTY_ALLOCATED: { subject: 'Faculty allocated for {{refNo}}', body: 'Faculty allocation completed for {{refNo}}.' },
  ASSIGNED: { subject: 'You have been assigned {{refNo}}', body: 'Please log in to view and edit your assigned handout.' },
  EDIT_STARTED: { subject: 'Editing started on {{refNo}}', body: '{{actor}} started editing {{refNo}}.' },
  SUBMITTED: { subject: 'Handout {{refNo}} submitted', body: 'Handout {{refNo}} is now awaiting review.' },
  REVIEW_REWORK: { subject: 'Rework requested on {{refNo}}', body: 'Please address the review comments and resubmit.' },
  REVIEW_APPROVED: { subject: 'Review approved for {{refNo}}', body: 'PC has approved {{refNo}} and forwarded to HOG.' },
  FINAL_APPROVED: { subject: 'Handout {{refNo}} approved', body: 'Handout {{refNo}} has been approved.' },
  FINAL_REJECTED: { subject: 'Handout {{refNo}} rejected', body: 'Handout {{refNo}} has been rejected.' },
  PUBLISHED: { subject: 'Handout {{refNo}} published to LMS', body: 'Handout {{refNo}} has been published to Taxila.' },
  ARCHIVED: { subject: 'Handout {{refNo}} archived', body: 'Handout {{refNo}} has been archived.' },
};

const LINK_PREFIX_BY_ROLE: Partial<Record<RoleName, (id: string) => string>> = {
  [RoleName.INSTRUCTION_CELL]: (id) => `/ic/requests/${id}`,
  [RoleName.HOG]: (id) => `/hog/requests/${id}`,
  [RoleName.PROGRAMME_COMMITTEE]: (id) => `/pc/requests/${id}`,
  [RoleName.FACULTY]: (id) => `/faculty/assignments/${id}`,
  [RoleName.ADMIN]: (id) => `/ic/requests/${id}`,
  [RoleName.SME]: (id) => `/faculty/assignments/${id}`,
};

interface RequestForNotify {
  id: string;
  refNo: string;
  initiatedById: string;
  offering: {
    course: { code: string; title: string };
    semester: { name: string; programme: { code: string } };
  };
  assignments: { facultyId: string; active: boolean }[];
}

async function loadRequest(requestId: string): Promise<RequestForNotify | null> {
  const r = await prisma.handoutRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      refNo: true,
      initiatedById: true,
      offering: {
        select: {
          course: { select: { code: true, title: true } },
          semester: { select: { name: true, programme: { select: { code: true } } } },
        },
      },
      assignments: { where: { active: true }, select: { facultyId: true, active: true } },
    },
  });
  return r;
}

async function usersWithRole(role: RoleName): Promise<{ id: string; email: string; primaryRole: RoleName }[]> {
  const users = await prisma.user.findMany({
    where: { active: true, roles: { some: { role: { name: role } } } },
    select: { id: true, email: true },
  });
  return users.map((u) => ({ ...u, primaryRole: role }));
}

async function usersById(ids: string[]): Promise<{ id: string; email: string; primaryRole: RoleName }[]> {
  if (ids.length === 0) return [];
  const users = await prisma.user.findMany({
    where: { id: { in: ids }, active: true },
    select: { id: true, email: true, roles: { select: { role: { select: { name: true } } } } },
  });
  return users.map((u) => ({
    id: u.id,
    email: u.email,
    primaryRole: (u.roles[0]?.role.name as RoleName) ?? RoleName.FACULTY,
  }));
}

async function computeRecipients(
  event: WorkflowEventType,
  req: RequestForNotify,
  actorId: string,
): Promise<{ id: string; email: string; primaryRole: RoleName }[]> {
  const out = new Map<string, { id: string; email: string; primaryRole: RoleName }>();
  const add = (us: { id: string; email: string; primaryRole: RoleName }[]) => {
    for (const u of us) if (u.id !== actorId) out.set(u.id, u);
  };
  const facultyIds = req.assignments.map((a) => a.facultyId);

  switch (event) {
    case 'REQUEST_INITIATED':
      add(await usersWithRole(RoleName.HOG));
      break;
    case 'FACULTY_ALLOCATED':
      add(await usersWithRole(RoleName.PROGRAMME_COMMITTEE));
      add(await usersById(facultyIds));
      break;
    case 'ASSIGNED':
      add(await usersById(facultyIds));
      break;
    case 'SUBMITTED':
      add(await usersWithRole(RoleName.PROGRAMME_COMMITTEE));
      break;
    case 'REVIEW_APPROVED':
      add(await usersWithRole(RoleName.HOG));
      break;
    case 'REVIEW_REWORK':
      add(await usersById(facultyIds));
      break;
    case 'FINAL_APPROVED':
      add(await usersWithRole(RoleName.INSTRUCTION_CELL));
      add(await usersById(facultyIds));
      break;
    case 'FINAL_REJECTED':
      add(await usersById(facultyIds));
      add(await usersWithRole(RoleName.INSTRUCTION_CELL));
      break;
    case 'PUBLISHED':
      add(await usersById(facultyIds));
      add(await usersById([req.initiatedById]));
      break;
    case 'ARCHIVED':
      add(await usersWithRole(RoleName.INSTRUCTION_CELL));
      break;
    case 'EDIT_STARTED':
      break;
  }
  return [...out.values()];
}

export function renderTemplate(tpl: string, tokens: Record<string, string>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k: string) => tokens[k] ?? `{{${k}}}`);
}

async function loadTemplate(key: string | null) {
  if (!key) return null;
  return prisma.notificationTemplate.findUnique({ where: { key } });
}

function linkFor(role: RoleName, requestId: string): string {
  return (LINK_PREFIX_BY_ROLE[role] ?? ((id: string) => `/ic/requests/${id}`))(requestId);
}

async function deliver(params: {
  userId: string;
  email: string;
  role: RoleName;
  subject: string;
  body: string;
  link: string;
  channels: NotificationChannel[];
  metaKind: string;
  extraMeta?: Record<string, unknown>;
}) {
  const { userId, email, subject, body, link, channels, metaKind, extraMeta } = params;
  for (const channel of channels) {
    try {
      const row = await prisma.notification.create({
        data: {
          userId,
          channel,
          status: NotificationStatus.PENDING,
          subject,
          body,
          link,
          meta: { kind: metaKind, ...(extraMeta ?? {}) },
        },
      });
      if (channel === NotificationChannel.IN_PORTAL) {
        await prisma.notification.update({
          where: { id: row.id },
          data: { status: NotificationStatus.SENT, sentAt: new Date() },
        });
      } else if (channel === NotificationChannel.EMAIL) {
        const html = `<p>${body}</p><p><a href="${link}">Open in HMP</a></p>`;
        const result = await sendMail({ to: email, subject, html, text: body });
        if (result.ok) {
          await prisma.notification.update({
            where: { id: row.id },
            data: { status: NotificationStatus.SENT, sentAt: new Date() },
          });
        } else {
          await prisma.notification.update({
            where: { id: row.id },
            data: {
              status: NotificationStatus.FAILED,
              meta: { kind: metaKind, error: result.error, ...(extraMeta ?? {}) },
            },
          });
        }
      }
    } catch (err) {
      console.error('[notify] delivery failed', { userId, channel, err });
    }
  }
}

export async function notifyTransition(input: {
  requestId: string;
  event: WorkflowEventType;
  actor: ActorRef;
}): Promise<void> {
  try {
    const req = await loadRequest(input.requestId);
    if (!req) return;
    const recipients = await computeRecipients(input.event, req, input.actor.id);
    if (recipients.length === 0) return;

    const tokens: Record<string, string> = {
      refNo: req.refNo,
      course: `${req.offering.course.code} — ${req.offering.course.title}`,
      programme: req.offering.semester.programme.code,
      semester: req.offering.semester.name,
      actor: input.actor.name,
    };

    const tpl = await loadTemplate(EVENT_TEMPLATE_KEY[input.event]);
    const fallback = INLINE_FALLBACK[input.event];
    const subjectTpl = tpl?.subject ?? fallback.subject;
    const bodyTpl = tpl?.body ?? fallback.body;
    const channels: NotificationChannel[] =
      tpl?.channels ?? [NotificationChannel.IN_PORTAL, NotificationChannel.EMAIL];

    const subject = renderTemplate(subjectTpl, tokens);
    const body = renderTemplate(bodyTpl, tokens);

    await Promise.allSettled(
      recipients.map((r) =>
        deliver({
          userId: r.id,
          email: r.email,
          role: r.primaryRole,
          subject,
          body,
          link: linkFor(r.primaryRole, req.id),
          channels,
          metaKind: 'workflow.transition',
          extraMeta: { event: input.event, requestId: req.id, refNo: req.refNo },
        }),
      ),
    );
  } catch (err) {
    console.error('[notifyTransition] failed', err);
  }
}

export async function notifyComment(input: {
  requestId: string;
  commentId: string;
  actor: ActorRef;
}): Promise<void> {
  try {
    const req = await loadRequest(input.requestId);
    if (!req) return;
    // Notify everyone currently involved: IC + HOG + PC + assigned faculty (minus actor).
    const out = new Map<string, { id: string; email: string; primaryRole: RoleName }>();
    const add = (us: { id: string; email: string; primaryRole: RoleName }[]) => {
      for (const u of us) if (u.id !== input.actor.id) out.set(u.id, u);
    };
    add(await usersWithRole(RoleName.INSTRUCTION_CELL));
    add(await usersWithRole(RoleName.HOG));
    add(await usersWithRole(RoleName.PROGRAMME_COMMITTEE));
    add(await usersById(req.assignments.map((a) => a.facultyId)));
    const recipients = [...out.values()];
    if (recipients.length === 0) return;

    const subject = `New comment on ${req.refNo}`;
    const body = `${input.actor.name} commented on ${req.refNo} (${req.offering.course.code}).`;

    await Promise.allSettled(
      recipients.map((r) =>
        deliver({
          userId: r.id,
          email: r.email,
          role: r.primaryRole,
          subject,
          body,
          link: linkFor(r.primaryRole, req.id),
          channels: [NotificationChannel.IN_PORTAL],
          metaKind: 'comment.added',
          extraMeta: { commentId: input.commentId, requestId: req.id, refNo: req.refNo },
        }),
      ),
    );
  } catch (err) {
    console.error('[notifyComment] failed', err);
  }
}

export async function notifySlaReminder(input: {
  request: Pick<HandoutRequest, 'id' | 'refNo' | 'status'>;
  classification: 'due_soon' | 'overdue';
  ageHours: number;
  slaHours: number;
}): Promise<number> {
  // Pick the role currently holding the request.
  // Note: DRAFT, PUBLISHED, ARCHIVED, REJECTED are intentionally omitted —
  // DRAFT is pre-workflow (IC hasn't initiated), PUBLISHED is a steady state
  // (no action expected before archive), and ARCHIVED/REJECTED are terminal.
  // Returning null below short-circuits reminder delivery for those statuses.
  const HOLDER_ROLE_MAP: Record<string, RoleName | null> = {
    REQUESTED: RoleName.HOG,
    ALLOCATED: RoleName.PROGRAMME_COMMITTEE,
    ASSIGNED: RoleName.FACULTY,
    IN_PROGRESS: RoleName.FACULTY,
    REWORK_REQUESTED: RoleName.FACULTY,
    SUBMITTED: RoleName.PROGRAMME_COMMITTEE,
    UNDER_REVIEW: RoleName.HOG,
    APPROVED: RoleName.INSTRUCTION_CELL,
  };
  const role = HOLDER_ROLE_MAP[input.request.status];
  if (!role) return 0;

  let recipients: { id: string; email: string; primaryRole: RoleName }[] = [];
  if (role === RoleName.FACULTY) {
    const assignments = await prisma.facultyAssignment.findMany({
      where: { requestId: input.request.id, active: true },
      select: { facultyId: true },
    });
    recipients = await usersById(assignments.map((a) => a.facultyId));
  } else {
    recipients = await usersWithRole(role);
  }
  if (recipients.length === 0) return 0;

  // Dedup window: don't ping the same user about same request+classification within slaHours/2.
  const windowMs = Math.max(1, input.slaHours * 0.5) * 3_600_000;
  const since = new Date(Date.now() - windowMs);
  const filtered: typeof recipients = [];
  for (const r of recipients) {
    const existing = await prisma.notification.findFirst({
      where: {
        userId: r.id,
        createdAt: { gte: since },
        AND: [
          { meta: { path: ['kind'], equals: 'sla.reminder' } },
          { meta: { path: ['requestId'], equals: input.request.id } },
          { meta: { path: ['classification'], equals: input.classification } },
        ],
      },
      select: { id: true },
    });
    if (!existing) filtered.push(r);
  }
  if (filtered.length === 0) return 0;

  const subject =
    input.classification === 'overdue'
      ? `Overdue: ${input.request.refNo} (${input.request.status})`
      : `Due soon: ${input.request.refNo} (${input.request.status})`;
  const body =
    input.classification === 'overdue'
      ? `${input.request.refNo} has been in ${input.request.status} for ${Math.round(input.ageHours)}h (SLA ${input.slaHours}h). Please take action.`
      : `${input.request.refNo} is approaching its SLA (${Math.round(input.ageHours)}h of ${input.slaHours}h in ${input.request.status}).`;

  await Promise.allSettled(
    filtered.map((r) =>
      deliver({
        userId: r.id,
        email: r.email,
        role: r.primaryRole,
        subject,
        body,
        link: linkFor(r.primaryRole, input.request.id),
        channels: [NotificationChannel.IN_PORTAL, NotificationChannel.EMAIL],
        metaKind: 'sla.reminder',
        extraMeta: {
          requestId: input.request.id,
          refNo: input.request.refNo,
          status: input.request.status,
          classification: input.classification,
          slaHours: input.slaHours,
        },
      }),
    ),
  );
  return filtered.length;
}

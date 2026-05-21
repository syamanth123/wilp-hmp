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
  // SMEs land on /sme/nominations (their list view) and navigate to detail
  // from there. The arg is intentionally unused — every other entry takes
  // an id, so we keep the signature `(id) => string` so callers don't have
  // to branch on role. (Prompt 7 will build the /sme route group.)
  [RoleName.SME]: (_id) => '/sme/nominations',
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

/**
 * Token suppliers for the four SME notification templates. Extracted as named,
 * exported functions (rather than inline object literals) so the token-contract
 * unit test can render each seeded template against the EXACT token set its
 * notify function supplies — see notifications.test.ts.
 *
 * `course` is the combined "CODE — Title" form kept for backward-compat with
 * any wording that uses {{course}}; `courseCode` / `courseTitle` are the split
 * forms the seeded templates use. Both are supplied so either works.
 */
export interface SmeTokenArgs {
  refNo: string;
  courseCode: string;
  courseTitle: string;
  programme: string;
  semester: string;
  actorName: string;
  topic: string;
  reason?: string;
}

function smeBaseTokens(a: SmeTokenArgs): Record<string, string> {
  return {
    refNo: a.refNo,
    course: `${a.courseCode} — ${a.courseTitle}`,
    courseCode: a.courseCode,
    courseTitle: a.courseTitle,
    programme: a.programme,
    semester: a.semester,
    actor: a.actorName,
    topic: a.topic,
  };
}

export function smeNominationTokens(a: SmeTokenArgs): Record<string, string> {
  return smeBaseTokens(a);
}
export function smeAcceptedTokens(a: SmeTokenArgs): Record<string, string> {
  return smeBaseTokens(a);
}
export function smeDeclinedTokens(a: SmeTokenArgs): Record<string, string> {
  return { ...smeBaseTokens(a), reason: a.reason ?? '' };
}
export function smeCompletedTokens(a: SmeTokenArgs): Record<string, string> {
  return smeBaseTokens(a);
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

/**
 * Fires when a PC nominates an SME on a request. Side-channel notification —
 * does NOT go through the workflow state machine.
 *
 * Tries to load the DB template `handout.sme_nominated` first; if absent
 * (the template row isn't seeded yet — Prompt 8 will add it), falls back
 * to hardcoded production-quality wording defined inline below.
 *
 * NOTE for Prompt 8: when you seed the `handout.sme_nominated` template,
 * the template's `subject` and `body` MUST equal or improve on the inline
 * fallback wording below — we do NOT want to introduce a copy regression
 * the day Prompt 8 lands. The inline wording here is what real recipients
 * see in production until that template exists. Treat as production copy.
 *
 * Whole body is wrapped in try / catch so a missing template, broken
 * `deliver()`, or any other failure inside this helper never propagates
 * back to the calling server action. The action's success path is
 * independent of notification delivery.
 */
export async function notifySmeNomination(input: {
  requestId: string;
  nominationId: string;
  smeUserId: string;
  topic: string;
  actor: ActorRef;
}): Promise<void> {
  try {
    const [req, sme, tpl] = await Promise.all([
      loadRequest(input.requestId),
      prisma.user.findUnique({
        where: { id: input.smeUserId },
        select: { id: true, email: true, name: true },
      }),
      loadTemplate('handout.sme_nominated'),
    ]);
    if (!req || !sme) {
      // No request or no SME user — nothing to notify. The action already
      // committed; this is a no-op, not a failure.
      return;
    }

    // Inline fallback wording. PROMPT 8: the seeded template's subject and
    // body must equal or improve on these strings to avoid a copy regression
    // (see jsdoc above).
    const fallbackSubject = `You have been nominated as SME for ${req.refNo}`;
    const fallbackBody =
      `${input.actor.name} has nominated you as a Subject Matter Expert to advise on handout ` +
      `${req.refNo} (${req.offering.course.code} — ${req.offering.course.title}). ` +
      `Topic: "${input.topic}". Please review the request and accept or decline at your earliest convenience.`;

    const tokens = smeNominationTokens({
      refNo: req.refNo,
      courseCode: req.offering.course.code,
      courseTitle: req.offering.course.title,
      programme: req.offering.semester.programme.code,
      semester: req.offering.semester.name,
      actorName: input.actor.name,
      topic: input.topic,
    });

    const subject = tpl ? renderTemplate(tpl.subject, tokens) : fallbackSubject;
    const body = tpl ? renderTemplate(tpl.body, tokens) : fallbackBody;
    const channels = tpl?.channels ?? [NotificationChannel.IN_PORTAL, NotificationChannel.EMAIL];

    await deliver({
      userId: sme.id,
      email: sme.email,
      role: RoleName.SME,
      subject,
      body,
      link: linkFor(RoleName.SME, req.id),
      channels,
      metaKind: 'sme.nominated',
      extraMeta: {
        nominationId: input.nominationId,
        requestId: req.id,
        refNo: req.refNo,
        topic: input.topic,
        templateMissing: !tpl,
      },
    });
  } catch (err) {
    console.error('[notifySmeNomination] failed', err);
  }
}

/**
 * Loads minimal info about an SmeNomination for the response notifications.
 * Pulls nominatedById (for PC recipient lookup) + smeUser name (for body
 * tokens). Returns null on miss — callers no-op the notification.
 */
async function loadNominationForResponseNotify(nominationId: string) {
  return prisma.smeNomination.findUnique({
    where: { id: nominationId },
    select: {
      id: true,
      topic: true,
      nominatedById: true,
      smeUser: { select: { id: true, name: true } },
    },
  });
}

/**
 * Fires when an SME accepts a PC's nomination. Recipient: the nominating PC
 * (one user — looked up by `SmeNomination.nominatedById`, not the broad
 * PROGRAMME_COMMITTEE role set, because only the originator needs to know
 * their specific nomination was accepted).
 *
 * Template `handout.sme_accepted` is missing until Prompt 8 — inline
 * fallback wording IS the production copy until then. Same wording-
 * regression guardrail as notifySmeNomination applies.
 */
export async function notifySmeAccepted(input: {
  requestId: string;
  nominationId: string;
  smeUserId: string;
  actor: ActorRef;
}): Promise<void> {
  try {
    const [req, nom, pc, tpl] = await Promise.all([
      loadRequest(input.requestId),
      loadNominationForResponseNotify(input.nominationId),
      // Resolve nominating PC lazily — we need their email + active status.
      // The nomination row carries the id; pull the rest here.
      (async () => {
        const nomRow = await prisma.smeNomination.findUnique({
          where: { id: input.nominationId },
          select: { nominatedBy: { select: { id: true, email: true, active: true } } },
        });
        return nomRow?.nominatedBy?.active ? nomRow.nominatedBy : null;
      })(),
      loadTemplate('handout.sme_accepted'),
    ]);
    if (!req || !nom || !pc) return;

    const fallbackSubject = `SME accepted your nomination on ${req.refNo}`;
    const fallbackBody =
      `${input.actor.name} accepted your SME nomination on ${req.refNo} ` +
      `(${req.offering.course.code} — ${req.offering.course.title}). ` +
      `Topic: "${nom.topic}". They can now advise on this handout.`;

    const tokens = smeAcceptedTokens({
      refNo: req.refNo,
      courseCode: req.offering.course.code,
      courseTitle: req.offering.course.title,
      programme: req.offering.semester.programme.code,
      semester: req.offering.semester.name,
      actorName: input.actor.name,
      topic: nom.topic,
    });

    const subject = tpl ? renderTemplate(tpl.subject, tokens) : fallbackSubject;
    const body = tpl ? renderTemplate(tpl.body, tokens) : fallbackBody;
    const channels = tpl?.channels ?? [NotificationChannel.IN_PORTAL, NotificationChannel.EMAIL];

    await deliver({
      userId: pc.id,
      email: pc.email,
      role: RoleName.PROGRAMME_COMMITTEE,
      subject,
      body,
      link: linkFor(RoleName.PROGRAMME_COMMITTEE, req.id),
      channels,
      metaKind: 'sme.accepted',
      extraMeta: {
        nominationId: input.nominationId,
        requestId: req.id,
        refNo: req.refNo,
        templateMissing: !tpl,
      },
    });
  } catch (err) {
    console.error('[notifySmeAccepted] failed', err);
  }
}

/**
 * Fires when an SME declines a PC's nomination. Recipient: the nominating PC.
 * Body includes the SME's reason so the PC has context to re-nominate
 * someone else.
 */
export async function notifySmeDeclined(input: {
  requestId: string;
  nominationId: string;
  smeUserId: string;
  reason: string;
  actor: ActorRef;
}): Promise<void> {
  try {
    const [req, nom, pc, tpl] = await Promise.all([
      loadRequest(input.requestId),
      loadNominationForResponseNotify(input.nominationId),
      (async () => {
        const nomRow = await prisma.smeNomination.findUnique({
          where: { id: input.nominationId },
          select: { nominatedBy: { select: { id: true, email: true, active: true } } },
        });
        return nomRow?.nominatedBy?.active ? nomRow.nominatedBy : null;
      })(),
      loadTemplate('handout.sme_declined'),
    ]);
    if (!req || !nom || !pc) return;

    const fallbackSubject = `SME declined your nomination on ${req.refNo}`;
    const fallbackBody =
      `${input.actor.name} declined your SME nomination on ${req.refNo} ` +
      `(${req.offering.course.code} — ${req.offering.course.title}). ` +
      `Reason: "${input.reason}". You can nominate a different SME from the request page.`;

    const tokens = smeDeclinedTokens({
      refNo: req.refNo,
      courseCode: req.offering.course.code,
      courseTitle: req.offering.course.title,
      programme: req.offering.semester.programme.code,
      semester: req.offering.semester.name,
      actorName: input.actor.name,
      topic: nom.topic,
      reason: input.reason,
    });

    const subject = tpl ? renderTemplate(tpl.subject, tokens) : fallbackSubject;
    const body = tpl ? renderTemplate(tpl.body, tokens) : fallbackBody;
    const channels = tpl?.channels ?? [NotificationChannel.IN_PORTAL, NotificationChannel.EMAIL];

    await deliver({
      userId: pc.id,
      email: pc.email,
      role: RoleName.PROGRAMME_COMMITTEE,
      subject,
      body,
      link: linkFor(RoleName.PROGRAMME_COMMITTEE, req.id),
      channels,
      metaKind: 'sme.declined',
      extraMeta: {
        nominationId: input.nominationId,
        requestId: req.id,
        refNo: req.refNo,
        reason: input.reason,
        templateMissing: !tpl,
      },
    });
  } catch (err) {
    console.error('[notifySmeDeclined] failed', err);
  }
}

/**
 * Fires when an SME marks their nomination COMPLETED. Recipients: the
 * nominating PC + all assigned faculty for the request (deduped — same Map
 * pattern as notifyComment). Faculty want to know an SME has finished their
 * advisory pass so they can review the comments left.
 */
export async function notifySmeCompleted(input: {
  requestId: string;
  nominationId: string;
  smeUserId: string;
  actor: ActorRef;
}): Promise<void> {
  try {
    const [req, nom, pc, tpl] = await Promise.all([
      loadRequest(input.requestId),
      loadNominationForResponseNotify(input.nominationId),
      (async () => {
        const nomRow = await prisma.smeNomination.findUnique({
          where: { id: input.nominationId },
          select: { nominatedBy: { select: { id: true, email: true, active: true } } },
        });
        return nomRow?.nominatedBy?.active ? nomRow.nominatedBy : null;
      })(),
      loadTemplate('handout.sme_completed'),
    ]);
    if (!req || !nom) return;

    // Map-dedup: PC + faculty. Same pattern as notifyComment. If the
    // nominating PC also happens to be assigned faculty (unlikely but
    // possible in dual-role setups), they receive a single notification.
    const out = new Map<string, { id: string; email: string; primaryRole: RoleName }>();
    const add = (us: { id: string; email: string; primaryRole: RoleName }[]) => {
      for (const u of us) if (u.id !== input.actor.id) out.set(u.id, u);
    };
    if (pc) {
      add([{ id: pc.id, email: pc.email, primaryRole: RoleName.PROGRAMME_COMMITTEE }]);
    }
    add(await usersById(req.assignments.map((a) => a.facultyId)));

    const recipients = [...out.values()];
    if (recipients.length === 0) return;

    const fallbackSubject = `SME completed advisory on ${req.refNo}`;
    const fallbackBody =
      `${input.actor.name} has completed their SME advisory work on ${req.refNo} ` +
      `(${req.offering.course.code} — ${req.offering.course.title}). ` +
      `Topic: "${nom.topic}". Review their comments on the handout page.`;

    const tokens = smeCompletedTokens({
      refNo: req.refNo,
      courseCode: req.offering.course.code,
      courseTitle: req.offering.course.title,
      programme: req.offering.semester.programme.code,
      semester: req.offering.semester.name,
      actorName: input.actor.name,
      topic: nom.topic,
    });

    const subject = tpl ? renderTemplate(tpl.subject, tokens) : fallbackSubject;
    const body = tpl ? renderTemplate(tpl.body, tokens) : fallbackBody;
    const channels = tpl?.channels ?? [NotificationChannel.IN_PORTAL, NotificationChannel.EMAIL];

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
          metaKind: 'sme.completed',
          extraMeta: {
            nominationId: input.nominationId,
            requestId: req.id,
            refNo: req.refNo,
            templateMissing: !tpl,
          },
        }),
      ),
    );
  } catch (err) {
    console.error('[notifySmeCompleted] failed', err);
  }
}

import {
  prisma,
  NotificationChannel,
  NotificationStatus,
  RoleName,
  ACTIVE_USER_FILTER,
  type HandoutRequest,
} from '@hmp/db';
import { sendMail } from '@hmp/integrations';
import { enqueueNotification, type NotifyJob } from '@hmp/queue';
// Package subpath (not '@/'): this file is also loaded by the worker under tsx.
import { statusLabel } from '@hmp/workflow/src/labels';
import { mentionedIn, peopleOnRequest } from './comment-people';

/**
 * The single boundary that decides queue-vs-synchronous for notifications.
 * When WORKERS_ENABLED=true it enqueues a job (the worker process calls the
 * matching dispatch* impl); otherwise — and ALSO if enqueue throws because
 * Redis is down — it runs the dispatch inline. So a queue outage gracefully
 * degrades to today's synchronous behaviour rather than dropping the
 * notification. This is the ONLY place WORKERS_ENABLED is read.
 *
 * Why a wrapper-per-notify + shared boundary (not the env check inside each
 * function): the worker must call the dispatch impl WITHOUT re-checking the
 * flag, or it would re-enqueue forever. So public `notify*` = enqueue-or-run
 * decision; `dispatch*` = the actual work (exported for the worker).
 */
async function dispatchOrEnqueue(job: NotifyJob, run: () => Promise<void>): Promise<void> {
  if (process.env.WORKERS_ENABLED === 'true') {
    try {
      await enqueueNotification(job);
      return;
    } catch (err) {
      console.error('[notify] enqueue failed — running inline', err);
      // fall through to synchronous dispatch
    }
  }
  await run();
}

export type WorkflowEventType =
  | 'REQUEST_INITIATED'
  | 'FACULTY_ALLOCATED'
  | 'ASSIGNED'
  | 'ALLOCATION_REJECTED'
  | 'EDIT_STARTED'
  | 'SUBMITTED'
  // Prompt 12-a (SME approval workflow). Kept in sync with @hmp/workflow's
  // WorkflowEvent['type'] union by hand — this local mirror exists so the
  // notifications module doesn't depend on the workflow package's types.
  | 'SME_REVIEW_REQUESTED'
  | 'SME_APPROVED'
  | 'SME_REVERTED'
  | 'REVIEW_REWORK'
  | 'REVIEW_APPROVED'
  | 'FINAL_APPROVED'
  | 'FINAL_REJECTED'
  | 'PUBLISHED'
  | 'ARCHIVED';

/** v1.4.2 (F6): sent at once even to people who chose the daily digest — the work came back to them. */
const URGENT_EVENTS: ReadonlySet<WorkflowEventType> = new Set<WorkflowEventType>([
  'ALLOCATION_REJECTED',
  'SME_REVERTED',
  'REVIEW_REWORK',
  'FINAL_REJECTED',
]);

interface ActorRef {
  id: string;
  name: string;
}

export const EVENT_TEMPLATE_KEY: Record<WorkflowEventType, string | null> = {
  REQUEST_INITIATED: 'handout.requested',
  FACULTY_ALLOCATED: 'handout.allocated',
  ASSIGNED: 'handout.assigned',
  ALLOCATION_REJECTED: 'handout.allocation_rejected',
  EDIT_STARTED: null,
  SUBMITTED: 'handout.submitted',
  // Prompt 12-b: real templates wired (12-a had these null/silent).
  SME_REVIEW_REQUESTED: 'handout.sme_review_requested',
  SME_APPROVED: 'handout.sme_approved',
  SME_REVERTED: 'handout.sme_reverted',
  REVIEW_REWORK: 'handout.rework',
  REVIEW_APPROVED: 'handout.review_approved',
  FINAL_APPROVED: 'handout.approved',
  FINAL_REJECTED: 'handout.rejected',
  PUBLISHED: 'handout.published',
  ARCHIVED: null,
};

const INLINE_FALLBACK: Record<WorkflowEventType, { subject: string; body: string }> = {
  REQUEST_INITIATED: {
    subject: 'New handout request {{refNo}}',
    body: 'A new handout request {{refNo}} has been initiated.',
  },
  FACULTY_ALLOCATED: {
    subject: 'Faculty allocated for {{refNo}}',
    body: 'Faculty allocation completed for {{refNo}}.',
  },
  ASSIGNED: {
    subject: 'You have been assigned {{refNo}}',
    body: 'Please log in to view and edit your assigned handout.',
  },
  ALLOCATION_REJECTED: {
    subject: 'Allocation for {{refNo}} needs revision',
    body: 'The Programme Committee rejected the faculty/SME allocation for {{refNo}}. Please review the reason and re-allocate.',
  },
  EDIT_STARTED: {
    subject: 'Editing started on {{refNo}}',
    body: '{{actor}} started editing {{refNo}}.',
  },
  SUBMITTED: {
    subject: 'Handout {{refNo}} submitted',
    body: 'Handout {{refNo}} is now awaiting review.',
  },
  // Prompt 12-b: inline fallback wording — kept in sync with the DB templates
  // in notification-templates.ts (SME_APPROVAL_TEMPLATES). Used when the DB
  // row is absent.
  SME_REVIEW_REQUESTED: {
    subject: 'SME review requested: {{refNo}}',
    body: '{{actor}} submitted {{refNo}} ({{course}}) for your SME review. Approve or request changes from your review queue.',
  },
  SME_APPROVED: {
    subject: 'SME approved: {{refNo}}',
    body: 'The SME approved {{refNo}} ({{course}}). It has moved to PC review.',
  },
  SME_REVERTED: {
    subject: 'SME requested changes: {{refNo}}',
    body: 'The SME sent {{refNo}} ({{course}}) back for changes. See the comment on the handout and resubmit.',
  },
  REVIEW_REWORK: {
    subject: 'Rework requested on {{refNo}}',
    body: 'Please address the review comments and resubmit.',
  },
  REVIEW_APPROVED: {
    subject: 'Review approved for {{refNo}}',
    body: 'PC has approved {{refNo}} and forwarded to HOG.',
  },
  FINAL_APPROVED: {
    subject: 'Handout {{refNo}} approved',
    body: 'Handout {{refNo}} has been approved.',
  },
  FINAL_REJECTED: {
    subject: 'Handout {{refNo}} rejected',
    body: 'Handout {{refNo}} has been rejected.',
  },
  PUBLISHED: {
    subject: 'Handout {{refNo}} published to LMS',
    body: 'Handout {{refNo}} has been published to Taxila.',
  },
  ARCHIVED: { subject: 'Handout {{refNo}} archived', body: 'Handout {{refNo}} has been archived.' },
};

const LINK_PREFIX_BY_ROLE: Partial<Record<RoleName, (id: string) => string>> = {
  [RoleName.INSTRUCTION_CELL]: (id) => `/ic/requests/${id}`,
  [RoleName.HOG]: (id) => `/hog/requests/${id}`,
  [RoleName.PROGRAMME_COMMITTEE]: (id) => `/pc/requests/${id}`,
  [RoleName.FACULTY]: (id) => `/faculty/assignments/${id}`,
  [RoleName.ADMIN]: (id) => `/ic/requests/${id}`,
  // v1.4.2 (F8): straight to the handout (was the SME list since Prompt 12-b).
  [RoleName.SME]: (id) => `/sme/review/${id}`,
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
  // Prompt 12-b: the assigned SME for this request (SmeAssignment.smeUserId),
  // or null. Carries the "assignedSme" recipient for SME_REVIEW_REQUESTED —
  // no separate resolver function needed; computeRecipients reads this field.
  smeUserId: string | null;
  /** v1.4.1: the programme's department, and who is the request's HOG / PC now (RequestAssignee). */
  departmentId: string | null;
  hogUserId: string | null;
  pcUserId: string | null;
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
          semester: {
            select: { name: true, programme: { select: { code: true, departmentId: true } } },
          },
        },
      },
      assignments: { where: { active: true }, select: { facultyId: true, active: true } },
      smeAssignment: { select: { smeUserId: true } },
      assignees: {
        where: { endedAt: null, role: { in: [RoleName.HOG, RoleName.PROGRAMME_COMMITTEE] } },
        orderBy: { assignedAt: 'desc' },
        select: { role: true, userId: true },
      },
    },
  });
  if (!r) return null;
  const { smeAssignment, assignees, ...rest } = r;
  return {
    ...rest,
    smeUserId: smeAssignment?.smeUserId ?? null,
    departmentId: r.offering.semester.programme.departmentId,
    hogUserId: assignees.find((a) => a.role === RoleName.HOG)?.userId ?? null,
    pcUserId: assignees.find((a) => a.role === RoleName.PROGRAMME_COMMITTEE)?.userId ?? null,
  };
}

async function usersWithRole(
  role: RoleName,
  departmentId?: string,
): Promise<{ id: string; email: string; primaryRole: RoleName }[]> {
  const users = await prisma.user.findMany({
    where: {
      ...ACTIVE_USER_FILTER,
      roles: { some: { role: { name: role } } },
      ...(departmentId ? { departmentId } : {}),
    },
    select: { id: true, email: true },
  });
  return users.map((u) => ({ ...u, primaryRole: role }));
}

/**
 * `as`: the role the notice is about (v1.4.2, F8) — a person with two roles gets that role's page, not
 * whichever role happens to come first.
 */
async function usersById(
  ids: string[],
  as?: RoleName,
): Promise<{ id: string; email: string; primaryRole: RoleName }[]> {
  if (ids.length === 0) return [];
  const users = await prisma.user.findMany({
    where: { id: { in: ids }, ...ACTIVE_USER_FILTER },
    select: { id: true, email: true, roles: { select: { role: { select: { name: true } } } } },
  });
  return users.map((u) => {
    const roles = u.roles.map((r) => r.role.name as RoleName);
    return {
      id: u.id,
      email: u.email,
      primaryRole: as && roles.includes(as) ? as : (roles[0] ?? RoleName.FACULTY),
    };
  });
}

/**
 * v1.4.2 (§4, H18): the back-ups of anyone in `list` who is away today, with the same role — they get a copy
 * of the notice while the person is away.
 */
async function withBackups(
  list: { id: string; email: string; primaryRole: RoleName }[],
): Promise<{ id: string; email: string; primaryRole: RoleName }[]> {
  if (list.length === 0) return list;
  const today = new Date();
  const prefs = await prisma.userPreference.findMany({
    where: {
      userId: { in: list.map((u) => u.id) },
      backupUserId: { not: null },
      awayUntil: { not: null },
    },
    select: { userId: true, awayFrom: true, awayUntil: true, backupUserId: true },
  });
  const ist = (d: Date) => Math.floor((d.getTime() + 5.5 * 3_600_000) / 86_400_000);
  const away = prefs.filter(
    (p) =>
      p.awayUntil &&
      ist(p.awayUntil) >= ist(today) &&
      (!p.awayFrom || ist(p.awayFrom) <= ist(today)),
  );
  if (away.length === 0) return list;
  const out = new Map(list.map((u) => [u.id, u]));
  for (const p of away) {
    const role = list.find((u) => u.id === p.userId)!.primaryRole;
    for (const b of await usersById([p.backupUserId!], role)) if (!out.has(b.id)) out.set(b.id, b);
  }
  return [...out.values()];
}

/**
 * v1.4.1 (docs/plans/v1.4.1-assignment.md §B): the request's own HOG / PC; for a request with none recorded
 * yet, its department's HOGs / PCs; if the department isn't known or has nobody in that role, everyone in
 * the role (as before v1.4.1). Nobody is left uninformed.
 */
async function responsible(
  role: typeof RoleName.HOG | typeof RoleName.PROGRAMME_COMMITTEE,
  req: RequestForNotify,
): Promise<{ id: string; email: string; primaryRole: RoleName }[]> {
  const assigned = role === RoleName.HOG ? req.hogUserId : req.pcUserId;
  if (assigned) {
    const u = await usersById([assigned], role);
    if (u.length) return u.map((x) => ({ ...x, primaryRole: role }));
  }
  if (req.departmentId) {
    const inDept = await usersWithRole(role, req.departmentId);
    if (inDept.length) return inDept;
  }
  return usersWithRole(role);
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
      add(await responsible(RoleName.HOG, req));
      break;
    case 'FACULTY_ALLOCATED':
      add(await responsible(RoleName.PROGRAMME_COMMITTEE, req));
      add(await usersById(facultyIds, RoleName.FACULTY));
      break;
    case 'ASSIGNED':
      add(await usersById(facultyIds, RoleName.FACULTY));
      break;
    // Prompt 22: PC rejected the allocation → back to HOG to re-allocate.
    // Matched-pair principle (audit §1): faculty WAS notified at
    // FACULTY_ALLOCATED, so retracting that allocation must notify them too.
    // SME is NOT notified — they weren't notified at allocation (they hear at
    // SME_REVIEW_REQUESTED later).
    case 'ALLOCATION_REJECTED': {
      add(await responsible(RoleName.HOG, req));
      // The just-rejected faculty were soft-deactivated INSIDE the reject
      // transaction, so req.assignments (active=true only) no longer lists
      // them. Query all assignments for the request to reach whoever was
      // allocated. (Post-reject the request is REQUESTED with no active
      // assignments yet, so this returns exactly the rejected set.)
      const wasAssigned = await prisma.facultyAssignment.findMany({
        where: { requestId: req.id },
        select: { facultyId: true },
      });
      add(
        await usersById(
          wasAssigned.map((a) => a.facultyId),
          RoleName.FACULTY,
        ),
      );
      break;
    }
    case 'SUBMITTED':
      // (v1.4.1: the request's PC — see responsible())
      // Prompt 12-b: DORMANT — no producer fires the bare SUBMITTED event
      // once SME is mandatory (faculty submit fires SME_REVIEW_REQUESTED; SME
      // approval fires SME_APPROVED, which lands in the SUBMITTED *status*).
      // Recipient kept for legacy/safety; see notification-templates.ts.
      add(await responsible(RoleName.PROGRAMME_COMMITTEE, req));
      break;
    // Prompt 12-b: SME approval-gate events.
    case 'SME_REVIEW_REQUESTED':
      // The assigned SME (the whole point of the gate) + IC for visibility.
      if (req.smeUserId) add(await usersById([req.smeUserId], RoleName.SME));
      add(await usersWithRole(RoleName.INSTRUCTION_CELL));
      break;
    case 'SME_APPROVED':
      // Faculty + IC, plus PC — PC inherits the "work arrived in your queue"
      // ping that the now-dormant handout.submitted used to carry. Async
      // workflows can't rely on dashboard polling; email-on-arrival is the
      // standard pattern. Do NOT drop PC here without reviewing that contract.
      add(await usersById(facultyIds, RoleName.FACULTY));
      add(await usersWithRole(RoleName.INSTRUCTION_CELL));
      add(await responsible(RoleName.PROGRAMME_COMMITTEE, req));
      break;
    case 'SME_REVERTED':
      add(await usersById(facultyIds, RoleName.FACULTY));
      add(await usersWithRole(RoleName.INSTRUCTION_CELL));
      break;
    case 'REVIEW_APPROVED':
      add(await responsible(RoleName.HOG, req));
      break;
    case 'REVIEW_REWORK':
      add(await usersById(facultyIds, RoleName.FACULTY));
      break;
    case 'FINAL_APPROVED':
      add(await usersWithRole(RoleName.INSTRUCTION_CELL));
      add(await usersById(facultyIds, RoleName.FACULTY));
      break;
    case 'FINAL_REJECTED':
      add(await usersById(facultyIds, RoleName.FACULTY));
      add(await usersWithRole(RoleName.INSTRUCTION_CELL));
      break;
    case 'PUBLISHED':
      add(await usersById(facultyIds, RoleName.FACULTY));
      add(await usersById([req.initiatedById], RoleName.INSTRUCTION_CELL));
      break;
    case 'ARCHIVED':
      add(await usersWithRole(RoleName.INSTRUCTION_CELL));
      break;
    case 'EDIT_STARTED':
      break;
  }
  // v1.4.2: an away person's back-up gets a copy (not the actor themselves).
  return (await withBackups([...out.values()])).filter((u) => u.id !== actorId);
}

export function renderTemplate(tpl: string, tokens: Record<string, string>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k: string) => tokens[k] ?? `{{${k}}}`);
}

/** Token supplier for the Taxila publish templates (Prompt 9b). The templates
 *  use refNo, courseCode, actor. Exported so the token-contract test renders
 *  the seeded strings against the exact tokens these notify functions pass. */
export interface PublishTokenArgs {
  refNo: string;
  courseCode: string;
  courseTitle: string;
  actorName: string;
}
export function publishNotificationTokens(a: PublishTokenArgs): Record<string, string> {
  return {
    refNo: a.refNo,
    course: `${a.courseCode} — ${a.courseTitle}`,
    courseCode: a.courseCode,
    courseTitle: a.courseTitle,
    actor: a.actorName,
  };
}

async function loadTemplate(key: string | null) {
  if (!key) return null;
  return prisma.notificationTemplate.findUnique({ where: { key } });
}

export function linkFor(role: RoleName, requestId: string): string {
  return (LINK_PREFIX_BY_ROLE[role] ?? ((id: string) => `/ic/requests/${id}`))(requestId);
}

/**
 * Absolute URL for links embedded in EMAIL. `linkFor` returns a relative path
 * (`/pc/requests/ID`) which resolves fine for the in-portal channel but is NOT
 * clickable in a mail client. Prefer `APP_BASE_URL`; fall back to `NEXTAUTH_URL`
 * so a deploy that set only the auth URL still emits a working link rather than
 * a broken relative one. If neither is set (local dev), the link is returned
 * unchanged. Closes the deployment-hardening gap noted in
 * docs/dev-handoff-audit.md.
 */
export function absoluteEmailLink(link: string): string {
  if (/^https?:\/\//i.test(link)) return link; // already absolute — leave it
  const base = (process.env.APP_BASE_URL ?? process.env.NEXTAUTH_URL ?? '').replace(/\/+$/, '');
  if (!base) return link;
  return `${base}${link.startsWith('/') ? '' : '/'}${link}`;
}

/**
 * Emails are sent in the background of the server process: the page that triggered them answers
 * as soon as the in-portal row is written, and a slow mail server can never hold it up. Each send
 * records SENT / FAILED on its notification row when it finishes. `emailsSettled()` waits for the
 * sends in flight — for the background worker (so a job ends after its emails) and for tests.
 */
const emailsInFlight = new Set<Promise<void>>();

export async function emailsSettled(): Promise<void> {
  while (emailsInFlight.size) await Promise.allSettled([...emailsInFlight]);
}

function sendEmailInBackground(
  rowId: string,
  input: { to: string; subject: string; html: string; text: string },
  meta: Record<string, unknown>,
) {
  const p = (async () => {
    try {
      const result = await sendMail(input);
      await prisma.notification.update({
        where: { id: rowId },
        data: result.ok
          ? { status: NotificationStatus.SENT, sentAt: new Date() }
          : { status: NotificationStatus.FAILED, meta: { ...meta, error: result.error } as never },
      });
    } catch (err) {
      console.error('[notify] email delivery failed', { rowId, err });
    }
  })();
  emailsInFlight.add(p);
  void p.finally(() => emailsInFlight.delete(p));
}

/** Exported for tests. */
export async function deliver(params: {
  userId: string;
  email: string;
  role: RoleName;
  subject: string;
  body: string;
  link: string;
  channels: NotificationChannel[];
  metaKind: string;
  extraMeta?: Record<string, unknown>;
  /**
   * v1.4.2 (F6): urgent emails (sent back, overdue, @mentions …) go at once even for people who chose the
   * daily digest; others wait for the 09:00 digest (lib/digest.ts). In-HMP notices are always immediate.
   */
  urgent?: boolean;
  /** v1.4.2: a ready-made HTML body (the weekly summary); otherwise the plain body + an Open link. */
  html?: string;
}) {
  const { userId, email, subject, body, link, channels, metaKind, extraMeta } = params;
  const digest =
    !params.urgent &&
    channels.includes(NotificationChannel.EMAIL) &&
    (await prisma.userPreference.findUnique({ where: { userId }, select: { emailMode: true } }))
      ?.emailMode === 'DIGEST';
  for (const channel of channels) {
    try {
      const waits = digest && channel === NotificationChannel.EMAIL;
      const row = await prisma.notification.create({
        data: {
          userId,
          channel,
          status: NotificationStatus.PENDING,
          subject,
          body,
          link,
          meta: { kind: metaKind, ...(extraMeta ?? {}), ...(waits ? { digest: true } : {}) },
        },
      });
      // Waits (PENDING) for the next daily digest.
      if (waits) continue;
      if (channel === NotificationChannel.IN_PORTAL) {
        await prisma.notification.update({
          where: { id: row.id },
          data: { status: NotificationStatus.SENT, sentAt: new Date() },
        });
      } else if (channel === NotificationChannel.EMAIL) {
        const html =
          params.html ??
          `<p>${body}</p><p><a href="${absoluteEmailLink(link)}">Open in HMP</a></p>`;
        sendEmailInBackground(
          row.id,
          { to: email, subject, html, text: body },
          { kind: metaKind, ...(extraMeta ?? {}) },
        );
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
  return dispatchOrEnqueue(
    {
      kind: 'transition',
      requestId: input.requestId,
      event: input.event,
      actor: input.actor,
      occurredAtMs: Date.now(),
    },
    () => dispatchTransition(input),
  );
}

export async function dispatchTransition(input: {
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
    const channels: NotificationChannel[] = tpl?.channels ?? [
      NotificationChannel.IN_PORTAL,
      NotificationChannel.EMAIL,
    ];

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
          urgent: URGENT_EVENTS.has(input.event),
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
  return dispatchOrEnqueue(
    { kind: 'comment', requestId: input.requestId, commentId: input.commentId, actor: input.actor },
    () => dispatchComment(input),
  );
}

export async function dispatchComment(input: {
  requestId: string;
  commentId: string;
  actor: ActorRef;
}): Promise<void> {
  try {
    const req = await loadRequest(input.requestId);
    if (!req) return;
    // Notify everyone currently involved: IC + the request's HOG + PC + assigned faculty (minus actor).
    const out = new Map<string, { id: string; email: string; primaryRole: RoleName }>();
    const add = (us: { id: string; email: string; primaryRole: RoleName }[]) => {
      for (const u of us) if (u.id !== input.actor.id) out.set(u.id, u);
    };
    add(await usersWithRole(RoleName.INSTRUCTION_CELL));
    // v1.4.1: the request's HOG and PC (their department's, if none recorded yet).
    add(await responsible(RoleName.HOG, req));
    add(await responsible(RoleName.PROGRAMME_COMMITTEE, req));
    add(
      await usersById(
        req.assignments.map((a) => a.facultyId),
        RoleName.FACULTY,
      ),
    );
    // v1.4.2 (F10): the SME is told too (left out before).
    if (req.smeUserId) add(await usersById([req.smeUserId], RoleName.SME));

    const comment = await prisma.comment.findUnique({
      where: { id: input.commentId },
      select: { body: true, parentId: true },
    });
    // v1.4.2 (F10): a reply tells everyone in that thread (the first comment's author and the repliers).
    if (comment?.parentId) {
      const thread = await prisma.comment.findMany({
        where: { OR: [{ id: comment.parentId }, { parentId: comment.parentId }] },
        select: { authorId: true },
      });
      add(await usersById([...new Set(thread.map((t) => t.authorId))]));
    }
    // v1.4.2 (F10, H22): @mentions — only people on the request; they get an email at once as well.
    const mentioned = comment
      ? mentionedIn(comment.body, await peopleOnRequest(req.id)).filter(
          (p) => p.id !== input.actor.id,
        )
      : [];
    const mentionIds = new Set(mentioned.map((m) => m.id));
    const recipients = (await withBackups([...out.values()])).filter(
      (u) => u.id !== input.actor.id && !mentionIds.has(u.id),
    );
    const excerpt = (comment?.body ?? '').slice(0, 500);
    const meta = { commentId: input.commentId, requestId: req.id, refNo: req.refNo };
    const course = `${req.offering.course.code} ${req.offering.course.title}`;
    for (const m of mentioned) {
      const [u] = await usersById([m.id]);
      if (!u) continue;
      await deliver({
        userId: u.id,
        email: u.email,
        role: u.primaryRole,
        subject: `${input.actor.name} mentioned you on ${req.refNo} (${course})`,
        body: `${input.actor.name} wrote on ${req.refNo}: “${excerpt}”`,
        link: `${linkFor(u.primaryRole, req.id)}#comments`,
        channels: [NotificationChannel.IN_PORTAL, NotificationChannel.EMAIL],
        metaKind: 'comment.mention',
        extraMeta: meta,
        urgent: true,
      });
    }
    if (recipients.length === 0) return;

    const subject = comment?.parentId ? `New reply on ${req.refNo}` : `New comment on ${req.refNo}`;
    const body = `${input.actor.name} ${comment?.parentId ? 'replied' : 'commented'} on ${req.refNo} (${req.offering.course.code}).`;

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
          extraMeta: meta,
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
  } else if (role === RoleName.HOG || role === RoleName.PROGRAMME_COMMITTEE) {
    // v1.4.1: the request's HOG / PC (else its department's, else everyone in the role).
    const req = await loadRequest(input.request.id);
    recipients = req ? await responsible(role, req) : [];
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

  const step = statusLabel(input.request.status);
  const subject =
    input.classification === 'overdue'
      ? `Overdue: ${input.request.refNo} ("${step}")`
      : `Due soon: ${input.request.refNo} ("${step}")`;
  const body =
    input.classification === 'overdue'
      ? `${input.request.refNo} has been "${step}" for ${Math.round(input.ageHours)} hours; the limit is ${input.slaHours} hours. Please take action.`
      : `${input.request.refNo} has been "${step}" for ${Math.round(input.ageHours)} of the ${input.slaHours} hours allowed.`;

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
 * Fires in Mode B when a handout is exported as a manual-upload package (the
 * request stays APPROVED until the IC confirms the manual upload). Audience:
 * the IC pool — the actor who triggered it plus other IC users, so the team
 * knows an export is pending confirmation. Template `handout.publish_export_ready`.
 */
export async function notifyPublishExportReady(input: {
  requestId: string;
  actor: ActorRef;
}): Promise<void> {
  return dispatchOrEnqueue(
    {
      kind: 'publish_export_ready',
      requestId: input.requestId,
      actor: input.actor,
      occurredAtMs: Date.now(),
    },
    () => dispatchPublishExportReady(input),
  );
}

export async function dispatchPublishExportReady(input: {
  requestId: string;
  actor: ActorRef;
}): Promise<void> {
  try {
    const [req, tpl] = await Promise.all([
      loadRequest(input.requestId),
      loadTemplate('handout.publish_export_ready'),
    ]);
    if (!req) return;

    // Self-notification: unlike most notify functions, the actor is INCLUDED.
    // An export-ready is a pending-task reminder — the IC who triggered it
    // needs the "download → upload → confirm" to-do in their bell/inbox, not
    // just other IC users. (Also why this isn't a notifyTransition reuse.)
    const out = new Map<string, { id: string; email: string; primaryRole: RoleName }>();
    for (const u of await usersWithRole(RoleName.INSTRUCTION_CELL)) {
      out.set(u.id, u);
    }
    const recipients = [...out.values()];
    if (recipients.length === 0) return;

    const fallbackSubject = `Export ready for manual upload: ${req.refNo}`;
    const fallbackBody =
      `The handout ${req.refNo} (${req.offering.course.code}) has been exported as a ` +
      `downloadable package. Download it from HMP, upload to Taxila manually, then mark ` +
      `it as published in HMP. Exported by ${input.actor.name}.`;
    const tokens = publishNotificationTokens({
      refNo: req.refNo,
      courseCode: req.offering.course.code,
      courseTitle: req.offering.course.title,
      actorName: input.actor.name,
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
          metaKind: 'handout.publish_export_ready',
          extraMeta: { requestId: req.id, refNo: req.refNo, templateMissing: !tpl },
        }),
      ),
    );
  } catch (err) {
    console.error('[notifyPublishExportReady] failed', err);
  }
}

/**
 * Fires when the IC confirms a manual publication (Mode B). Audience: HOG + PC
 * + assigned faculty + IC pool — same set the workflow PUBLISHED event would
 * notify. Kept as its own template `handout.manually_published` (NOT a reuse of
 * notifyTransition('PUBLISHED')) because the wording signals the publish was
 * a manual ZIP upload, not an automated API push — the audit breadcrumb for
 * "PUBLISHED but Taxila has no automated record".
 */
export async function notifyManuallyPublished(input: {
  requestId: string;
  actor: ActorRef;
}): Promise<void> {
  return dispatchOrEnqueue(
    { kind: 'manually_published', requestId: input.requestId, actor: input.actor },
    () => dispatchManuallyPublished(input),
  );
}

export async function dispatchManuallyPublished(input: {
  requestId: string;
  actor: ActorRef;
}): Promise<void> {
  try {
    const [req, tpl] = await Promise.all([
      loadRequest(input.requestId),
      loadTemplate('handout.manually_published'),
    ]);
    if (!req) return;

    const out = new Map<string, { id: string; email: string; primaryRole: RoleName }>();
    const add = (us: { id: string; email: string; primaryRole: RoleName }[]) => {
      for (const u of us) if (u.id !== input.actor.id) out.set(u.id, u);
    };
    // v1.4.1: the request's HOG and PC (their department's, if none recorded yet).
    add(await responsible(RoleName.HOG, req));
    add(await responsible(RoleName.PROGRAMME_COMMITTEE, req));
    add(await usersWithRole(RoleName.INSTRUCTION_CELL));
    add(await usersById(req.assignments.map((a) => a.facultyId)));
    const recipients = [...out.values()];
    if (recipients.length === 0) return;

    const fallbackSubject = `Manually published: ${req.refNo}`;
    const fallbackBody =
      `${input.actor.name} confirmed manual publication of ${req.refNo} ` +
      `(${req.offering.course.code}) to Taxila. The request is now in PUBLISHED state.`;
    const tokens = publishNotificationTokens({
      refNo: req.refNo,
      courseCode: req.offering.course.code,
      courseTitle: req.offering.course.title,
      actorName: input.actor.name,
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
          metaKind: 'handout.manually_published',
          extraMeta: { requestId: req.id, refNo: req.refNo, templateMissing: !tpl },
        }),
      ),
    );
  } catch (err) {
    console.error('[notifyManuallyPublished] failed', err);
  }
}

/**
 * v1.4.2 — notices from the daily run (reminders, escalation) and other server-side senders. `ids` are user
 * ids; `as` is the role the notice is about (for the link). Back-ups of away people get a copy.
 */
export async function deliverToUsers(
  ids: string[],
  as: RoleName | null,
  n: {
    requestId: string;
    subject: string;
    body: string;
    metaKind: string;
    extraMeta?: Record<string, unknown>;
    urgent?: boolean;
    channels?: NotificationChannel[];
    link?: (role: RoleName) => string;
  },
): Promise<number> {
  const people = await withBackups(await usersById([...new Set(ids)], as ?? undefined));
  await Promise.allSettled(
    people.map((r) =>
      deliver({
        userId: r.id,
        email: r.email,
        role: r.primaryRole,
        subject: n.subject,
        body: n.body,
        link: n.link ? n.link(r.primaryRole) : linkFor(r.primaryRole, n.requestId),
        channels: n.channels ?? [NotificationChannel.IN_PORTAL, NotificationChannel.EMAIL],
        metaKind: n.metaKind,
        extraMeta: { requestId: n.requestId, ...(n.extraMeta ?? {}) },
        urgent: n.urgent,
      }),
    ),
  );
  return people.length;
}

/** v1.4.2: active Instruction Cell user ids (escalation level 3, auto-publish problems). */
export async function instructionCellIds(): Promise<string[]> {
  return (await usersWithRole(RoleName.INSTRUCTION_CELL)).map((u) => u.id);
}

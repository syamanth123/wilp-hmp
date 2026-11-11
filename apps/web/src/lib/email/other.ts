import { RoleName } from '@hmp/db';
import { dueWords, formatDueDay } from '../deadlines';
import { formatDateTime } from '../format-date';
import { ROLE_LABEL } from '../labels';
import { wordingFor } from './catalogue';
import { requestEmail, type MailContext, type MailRecipient } from './events';
import type { EmailContent, EmailRow } from './layout';
import type { RequestFacts } from './request-facts';

/**
 * v1.4.3 (§G) — the emails that aren't a workflow step: reminders and escalation, comments, hand-over,
 * welcome, access changes, back-up, Taxila and auto-publish, the daily digest, the weekly summary and the
 * combined email for bulk actions.
 */

function footer(ctx: MailContext, why: string): EmailContent['footer'] {
  return {
    why,
    settingsUrl: ctx.url('/settings'),
    help: ctx.footer.help,
    replyTo: ctx.footer.replyTo,
  };
}

// ---- reminders and escalation -----------------------------------------------------------------

/**
 * Reminder (due soon / overdue) to the person who has the step; with `copy`, the escalation copy for the
 * HOG (level 2) or the Instruction Cell (level 3).
 */
export function reminderEmail(
  f: RequestFacts,
  to: MailRecipient,
  o: { copy: boolean; holders: string[]; told: string[] },
  ctx: MailContext,
): EmailContent | null {
  const due = f.current;
  if (!due) return null;
  const w = dueWords(due.dueAt, ctx.now);
  const holders = o.holders.join(', ') || 'the person responsible';
  const key = o.copy
    ? to.role === RoleName.INSTRUCTION_CELL
      ? 'escalation:IC'
      : 'escalation:HOG'
    : w.tone === 'overdue'
      ? 'reminder.overdue'
      : 'reminder.due-soon';
  const later = f.deadlines.filter((d) => d.state === 'later').map((d) => d.label);
  const rows: EmailRow[] = [
    { label: 'Step', value: `${due.label} — with ${holders}` },
    {
      label: 'Due',
      value: `${formatDueDay(due.dueAt)} (${w.text})${
        due.source === 'manual'
          ? ` · date set by ${due.setByName ?? 'someone'}: “${due.reason ?? ''}”`
          : ''
      }`,
    },
    ...(o.told.length ? [{ label: 'Already told', value: o.told.join(', ') }] : []),
    ...(later.length ? [{ label: 'Waiting on this', value: later.join(' → ') }] : []),
  ];
  return requestEmail(key, f, to, ctx, {
    tokens: { holders },
    happened: { title: 'Where it stands', rows },
    subjectDue: false,
    timeline: 3,
    why: o.copy
      ? to.role === RoleName.INSTRUCTION_CELL
        ? 'You get this because an overdue step was escalated to the Instruction Cell.'
        : 'You get this because you are the Head of Group for this request and a step is overdue.'
      : 'You get this because this step is yours.',
  });
}

// ---- comments ---------------------------------------------------------------------------------

export function commentEmail(
  f: RequestFacts,
  to: MailRecipient,
  o: {
    mention: boolean;
    author: string;
    at: Date;
    text: string;
    parent?: { author: string; at: Date; text: string } | null;
  },
  ctx: MailContext,
): EmailContent {
  return requestEmail(o.mention ? 'comment.mention' : 'comment.reply', f, to, ctx, {
    tokens: { actor: o.author },
    anchor: '#comments',
    timeline: 3,
    happened: {
      title: o.parent ? 'The reply' : 'The comment',
      quotes: [
        ...(o.parent
          ? [
              {
                by: `${o.parent.author} wrote`,
                when: formatDateTime(o.parent.at),
                text: o.parent.text,
              },
            ]
          : []),
        { by: o.author, when: formatDateTime(o.at), text: o.text },
      ],
    },
    why: o.mention
      ? 'You get this because you were @mentioned.'
      : 'You get this because you are in this comment thread.',
  });
}

// ---- hand-over --------------------------------------------------------------------------------

export function handoverEmail(
  f: RequestFacts,
  to: MailRecipient,
  o: { isNew: boolean; role: string; from: string | null; toName: string; reason: string },
  ctx: MailContext,
): EmailContent {
  return requestEmail(o.isNew ? 'handover:NEW' : 'handover:PREVIOUS', f, to, ctx, {
    tokens: { role: o.role, previous: o.from ?? '', reason: o.reason },
    happened: {
      title: 'The hand-over',
      rows: [
        { label: 'Role', value: o.role },
        ...(o.from ? [{ label: 'From', value: o.from }] : []),
        { label: 'To', value: o.toName },
        { label: 'By', value: ctx.actorName },
        { label: 'Reason', value: o.reason },
      ],
    },
    why: o.isNew
      ? 'You get this because the work was handed over to you.'
      : 'You get this because the work was handed over from you.',
  });
}

// ---- auto-publish -----------------------------------------------------------------------------

export function autoPublishStoppedEmail(
  f: RequestFacts,
  to: MailRecipient,
  o: { reason: string },
  ctx: MailContext,
): EmailContent {
  return requestEmail('auto-publish.stopped', f, to, ctx, {
    tokens: { reason: o.reason },
    happened: { title: 'What stopped it', rows: [{ label: 'Reason', value: o.reason }] },
  });
}

// ---- people and accounts ----------------------------------------------------------------------

const MENU: Partial<Record<RoleName, string>> = {
  [RoleName.INSTRUCTION_CELL]: 'Requests, Kick off a semester, Dashboard, People and Departments',
  [RoleName.HOG]: 'your department’s requests, Allocate, My department and final approval',
  [RoleName.PROGRAMME_COMMITTEE]: 'allocations to confirm and handouts to review',
  [RoleName.FACULTY]: 'your assigned handouts, to write and submit',
  [RoleName.SME]: 'handouts waiting for your review',
  [RoleName.ADMIN]: 'Admin: users, workflow, notifications and background jobs',
};

const roleWords = (roles: RoleName[]) => roles.map((r) => ROLE_LABEL[r] ?? r).join(', ') || 'none';

/** Welcome to a new account. Never a password: BITS sign-in, or the Admin gives one. */
export function welcomeEmail(
  to: { name: string; email: string; roles: RoleName[]; department: string | null },
  o: { addedBy: string; sso: boolean },
  ctx: MailContext,
): EmailContent {
  const w = wordingFor(
    o.sso ? 'welcome' : 'welcome.password',
    { name: to.name, by: o.addedBy },
    ctx.edits,
  );
  return {
    subject: w.subject,
    greetingName: to.name,
    summary: w.summary,
    action: { needed: true, text: w.action },
    button: { label: w.entry.button, url: ctx.url('/login') },
    happened: {
      title: 'Your account',
      rows: [
        { label: 'Sign-in email', value: to.email },
        { label: 'Roles', value: roleWords(to.roles) },
        { label: 'Department', value: to.department ?? 'All departments' },
      ],
      bullets: [
        ...to.roles.map(
          (r) => `As ${ROLE_LABEL[r] ?? r}, your menu has ${MENU[r] ?? 'your pages'}.`,
        ),
        'Your home page starts with “My work”: what needs you, soonest due first.',
        'In My settings you can choose one email a day instead of one per notice, and mark yourself away.',
      ],
    },
    footer: footer(ctx, 'You get this because an HMP account was made for you.'),
    logoUrl: ctx.logoUrl,
  };
}

/** Someone changed your roles or department (or undid such a change). */
export function roleChangedEmail(
  to: { name: string },
  o: {
    by: string;
    undo: boolean;
    before: { roles: RoleName[]; department: string | null };
    after: { roles: RoleName[]; department: string | null };
  },
  ctx: MailContext,
): EmailContent {
  const w = wordingFor(
    o.undo ? 'access.undone' : 'access.changed',
    { name: to.name, by: o.by },
    ctx.edits,
  );
  const added = o.after.roles.filter((r) => !o.before.roles.includes(r));
  const removed = o.before.roles.filter((r) => !o.after.roles.includes(r));
  return {
    subject: w.subject,
    greetingName: to.name,
    summary: w.summary,
    action: { needed: false, text: w.action },
    button: { label: w.entry.button, url: ctx.url('/') },
    happened: {
      title: 'What changed',
      rows: [
        { label: 'Roles', value: `${roleWords(o.before.roles)} → ${roleWords(o.after.roles)}` },
        ...(o.before.department !== o.after.department
          ? [
              {
                label: 'Department',
                value: `${o.before.department ?? 'none'} → ${o.after.department ?? 'none'}`,
              },
            ]
          : []),
        { label: 'Changed by', value: o.by },
      ],
      bullets: [
        ...added.map((r) => `New: ${MENU[r] ?? ROLE_LABEL[r]}.`),
        ...removed.map(
          (r) => `Gone: ${MENU[r] ?? ROLE_LABEL[r]}. Open work in that role was handed over.`,
        ),
      ],
    },
    footer: footer(ctx, 'You get this because your own HMP access changed.'),
    logoUrl: ctx.logoUrl,
  };
}

export function backupEmail(
  to: { name: string },
  o: { named: boolean; person: string; from?: string | null; until?: string | null },
  ctx: MailContext,
): EmailContent {
  const w = wordingFor(
    o.named ? 'backup.named' : 'backup.removed',
    { name: to.name, person: o.person, until: o.until ?? '' },
    ctx.edits,
  );
  return {
    subject: w.subject,
    greetingName: to.name,
    summary: w.summary,
    action: { needed: false, text: w.action },
    button: { label: w.entry.button, url: ctx.url('/') },
    happened: o.named
      ? {
          title: 'The cover',
          rows: [
            { label: 'Covering for', value: o.person },
            ...(o.from ? [{ label: 'From', value: o.from }] : []),
            ...(o.until ? [{ label: 'Until', value: o.until }] : []),
          ],
        }
      : null,
    footer: footer(ctx, 'You get this because you were named, or no longer named, as a back-up.'),
    logoUrl: ctx.logoUrl,
  };
}

// ---- Taxila run -------------------------------------------------------------------------------

export function taxilaRunEmail(
  to: { name: string },
  o: { line: string; url: string; problems: { title: string; reason: string }[] },
  ctx: MailContext,
): EmailContent {
  const w = wordingFor('taxila.run-finished', { name: to.name }, ctx.edits);
  return {
    subject: `${w.subject}: ${o.line}`,
    greetingName: to.name,
    summary: w.summary,
    action: {
      needed: o.problems.length > 0,
      text: o.problems.length ? w.action : 'Nothing to do: everything was published.',
    },
    button: { label: w.entry.button, url: o.url },
    happened: {
      title: 'Result',
      rows: [{ label: 'Summary', value: o.line }],
      bullets: o.problems.map((p) => `${p.title}: ${p.reason}`),
    },
    footer: footer(ctx, 'You get this because you started this Taxila run.'),
    logoUrl: ctx.logoUrl,
  };
}

// ---- digest, bulk, weekly ---------------------------------------------------------------------

/** One compact block (daily digest, bulk emails), stored with a held notice. */
export interface DigestItem {
  action: boolean;
  title: string;
  url: string;
  lines: string[];
  /** For sorting "Action needed" soonest due first (ISO). */
  dueAt?: string | null;
}

/** The compact block for an email: its subject, summary and due line. */
export function digestItemOf(c: EmailContent, dueAt?: Date | null): DigestItem {
  const due = c.action.due;
  return {
    action: c.action.needed,
    title: c.subject,
    url: c.button?.url ?? '',
    lines: [c.summary, ...(due ? [`By ${due.day} · ${due.words}`] : [])],
    dueAt: dueAt ? dueAt.toISOString() : null,
  };
}

function sortItems(items: DigestItem[]): DigestItem[] {
  return [...items].sort((a, b) => (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999'));
}

/** The 09:00 daily email for people who chose it — one compact block per item. */
export function digestEmail(
  to: { name: string },
  items: DigestItem[],
  ctx: MailContext,
): EmailContent {
  const todo = sortItems(items.filter((i) => i.action));
  return {
    subject: `Your daily summary: ${todo.length ? `${todo.length} need${todo.length === 1 ? 's' : ''} you, ` : ''}${items.length} update${items.length === 1 ? '' : 's'}`,
    greetingName: to.name,
    summary: 'Here is what happened in HMP since yesterday’s summary.',
    action: todo.length
      ? {
          needed: true,
          text: `${todo.length} item${todo.length === 1 ? ' needs' : 's need'} you — listed first, soonest due first.`,
        }
      : { needed: false, text: 'Nothing needs you; these are for your information.' },
    button: { label: 'Open My work', url: ctx.url('/') },
    groups: [
      { title: 'Action needed', items: todo },
      { title: 'For information', items: items.filter((i) => !i.action) },
    ],
    footer: footer(
      ctx,
      'You get one email a day because you chose it in My settings. Urgent ones (sent back, overdue, @mentions) still come at once.',
    ),
    logoUrl: ctx.logoUrl,
  };
}

/** H31: a bulk action (kick-off, upload, bulk allocate, bulk review) — one email per person, all requests. */
export function bulkEmail(
  to: { name: string },
  o: { actor: string; items: DigestItem[] },
  ctx: MailContext,
): EmailContent {
  const todo = sortItems(o.items.filter((i) => i.action));
  const n = o.items.length;
  return {
    subject: todo.length
      ? `Action needed: ${todo.length} request${todo.length === 1 ? '' : 's'} from ${o.actor}`
      : `${n} update${n === 1 ? '' : 's'} from ${o.actor}`,
    greetingName: to.name,
    summary: `${o.actor} updated ${n} handout request${n === 1 ? '' : 's'} at once. They are all in this one email.`,
    action: todo.length
      ? {
          needed: true,
          text: `${todo.length} of them need${todo.length === 1 ? 's' : ''} you — listed first, soonest due first.`,
        }
      : { needed: false, text: 'Nothing needs you; these are for your information.' },
    button: { label: 'Open My work', url: ctx.url('/') },
    groups: [
      { title: 'Action needed', items: todo },
      { title: 'For information', items: o.items.filter((i) => !i.action) },
    ],
    footer: footer(ctx, 'You get this because you are on these requests.'),
    logoUrl: ctx.logoUrl,
  };
}

export interface WeeklyDept {
  name: string;
  inProgress: number;
  approved: number;
  publishedThisWeek: number;
  overdue: { refNo: string; course: string; step: string; days: number; url: string }[];
}

/** The Monday summary, in the shared layout. */
export function weeklyEmail(
  to: { name: string },
  o: { week: string; depts: WeeklyDept[]; dashboardUrl: string },
  ctx: MailContext,
): EmailContent {
  const overdue = o.depts.reduce((n, d) => n + d.overdue.length, 0);
  return {
    subject: `Weekly summary — week of ${o.week}`,
    greetingName: to.name,
    summary: `Here is this week in HMP: ${overdue} overdue across ${o.depts.length} department${o.depts.length === 1 ? '' : 's'}.`,
    action: overdue
      ? { needed: true, text: 'Follow up the overdue requests below (most overdue first).' }
      : { needed: false, text: 'Nothing is overdue.' },
    button: { label: 'Open the dashboard', url: o.dashboardUrl },
    groups: o.depts.map((d) => ({
      title: d.name,
      count: false,
      note: `${d.inProgress} in progress · ${d.overdue.length} overdue · ${d.approved} approved, not yet published · ${d.publishedThisWeek} published this week${d.overdue.length > 10 ? ' · the 10 most overdue below' : ''}`,
      items: d.overdue.slice(0, 10).map((x) => ({
        title: `${x.refNo} ${x.course}`,
        url: x.url,
        lines: [`${x.step} — ${x.days} day${x.days === 1 ? '' : 's'} overdue`],
      })),
    })),
    footer: footer(
      ctx,
      'Sent every Monday to Heads of Group and the Instruction Cell. You can switch it off in My settings.',
    ),
    logoUrl: ctx.logoUrl,
  };
}

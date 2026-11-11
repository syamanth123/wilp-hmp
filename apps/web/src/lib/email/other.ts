import { RoleName } from '@hmp/db';
import { dueWords, formatDueDay, STAGE_HOLDER, STAGE_LABEL } from '../deadlines';
import { ROLE_LABEL } from '../labels';
import type { EmailContent } from './layout';
import { detailRows, peopleRows, recentSteps, type RequestFacts } from './request-facts';
import type { MailContext, MailRecipient } from './events';

/** v1.4.3 (§G) — the emails that aren't a workflow step: reminders and escalation, welcome, role changes. */

const HOLDER_WORD = {
  HOG: 'Head of Group',
  PC: 'Programme Committee',
  FACULTY: 'faculty',
  SME: 'SME',
  IC: 'Instruction Cell',
} as const;

const PAGE: Partial<Record<RoleName, (id: string) => string>> = {
  [RoleName.INSTRUCTION_CELL]: (id) => `/ic/requests/${id}`,
  [RoleName.HOG]: (id) => `/hog/requests/${id}`,
  [RoleName.PROGRAMME_COMMITTEE]: (id) => `/pc/requests/${id}`,
  [RoleName.FACULTY]: (id) => `/faculty/assignments/${id}`,
  [RoleName.SME]: (id) => `/sme/review/${id}`,
};

function footer(ctx: MailContext, why: string): EmailContent['footer'] {
  return {
    why,
    settingsUrl: ctx.url('/settings'),
    help: ctx.footer.help,
    replyTo: ctx.footer.replyTo,
  };
}

/**
 * Reminder (level 0 due soon, 1 overdue) to the person who has the step, and escalation copies (level 2 to
 * the HOG, 3 to the Instruction Cell) — `copy` says which.
 */
export function reminderEmail(
  f: RequestFacts,
  to: MailRecipient,
  o: { level: number; copy: boolean; holders: string[]; told: string[] },
  ctx: MailContext,
): EmailContent | null {
  const due = f.current;
  if (!due) return null;
  const w = dueWords(due.dueAt, ctx.now);
  const course = `${f.course.code} ${f.course.title}`;
  const step = STAGE_LABEL[due.stage];
  const holder = HOLDER_WORD[STAGE_HOLDER[due.stage]];
  const holders = o.holders.join(', ') || `the ${holder}`;
  const overdue = w.tone === 'overdue';
  const later = f.deadlines.filter((d) => d.state === 'later').map((d) => d.label);
  const subject = o.copy
    ? `Overdue: ${holders} — ${step}, ${course} (${f.semester.name}), ${w.text}`
    : overdue
      ? `Overdue: ${step} for ${course} (${f.semester.name}) — ${w.text}`
      : `Due soon: ${step} for ${course} (${f.semester.name}) — ${w.text}`;
  return {
    subject,
    greetingName: to.name,
    summary: o.copy
      ? `“${step}” for ${course} is ${w.text}. It is with ${holders}.`
      : overdue
        ? `“${step}” for ${course} is ${w.text}.`
        : `“${step}” for ${course} is due on ${formatDueDay(due.dueAt)}.`,
    action: o.copy
      ? {
          needed: true,
          text: `Please follow up with ${holders}${to.role === RoleName.INSTRUCTION_CELL ? ' and the Head of Group' : ''}. If the work should move to someone else, use Hand over on the request page. If the date is wrong, change it there (with a reason).`,
          due: { day: formatDueDay(due.dueAt), words: `${step} · ${w.text}`, tone: w.tone },
        }
      : {
          needed: true,
          text: overdue
            ? 'Please finish this step as soon as you can. If you cannot, tell the Head of Group so it can be handed over or the date changed.'
            : 'Please finish this step by the due date.',
          due: { day: formatDueDay(due.dueAt), words: `${step} · ${w.text}`, tone: w.tone },
        },
    button: {
      label: 'Open the request',
      url: ctx.url((PAGE[to.role] ?? PAGE[RoleName.INSTRUCTION_CELL]!)(f.id)),
    },
    happened: {
      title: 'Where it stands',
      rows: [
        { label: 'Step', value: `${step} — with ${holders}` },
        {
          label: 'Due',
          value: `${formatDueDay(due.dueAt)} (${w.text})${due.source === 'manual' ? ` · date set by ${due.setByName ?? 'someone'}: “${due.reason}”` : ''}`,
        },
        ...(o.told.length ? [{ label: 'Already told', value: o.told.join(', ') }] : []),
        ...(later.length ? [{ label: 'Waiting on this', value: later.join(' → ') }] : []),
      ],
    },
    details: detailRows(f),
    people: peopleRows(f),
    timeline: recentSteps(f, 3),
    footer: footer(
      ctx,
      o.copy
        ? to.role === RoleName.INSTRUCTION_CELL
          ? 'You get this because an overdue step was escalated to the Instruction Cell.'
          : 'You get this because you are the Head of Group for this request and a step is overdue.'
        : 'You get this because this step is yours.',
    ),
    logoUrl: ctx.logoUrl,
  };
}

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
  return {
    subject: 'Your HMP account is ready',
    greetingName: to.name,
    summary: `${o.addedBy} has given you an account in HMP, the portal where BITS WILP course handouts are requested, written, reviewed and published to Taxila.`,
    action: {
      needed: true,
      text: o.sso
        ? `Sign in with your BITS ID (${to.email}): press “Sign in with BITS” on the sign-in page.`
        : `Sign in with your email address (${to.email}). The HMP administrator will give you your password separately.`,
    },
    button: { label: 'Sign in to HMP', url: ctx.url('/login') },
    happened: {
      title: 'Your account',
      rows: [
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
  const added = o.after.roles.filter((r) => !o.before.roles.includes(r));
  const removed = o.before.roles.filter((r) => !o.after.roles.includes(r));
  const rows = [
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
  ];
  return {
    subject: o.undo ? 'A change to your HMP access was undone' : 'Your HMP access has changed',
    greetingName: to.name,
    summary: o.undo
      ? `${o.by} undid the recent change to your HMP roles or department.`
      : `${o.by} changed your HMP roles or department.`,
    action: {
      needed: false,
      text: 'Your menu changes the next time you open HMP. If this looks wrong, contact the Instruction Cell.',
    },
    button: { label: 'Open HMP', url: ctx.url('/') },
    happened: {
      title: 'What changed',
      rows,
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

/** One held notice in the daily digest (its compact block is stored with the notice when it is held). */
export interface DigestItem {
  action: boolean;
  title: string;
  url: string;
  lines: string[];
}

/** v1.4.3: the 09:00 daily email for people who chose it — same facts, one compact block per item. */
export function digestEmail(
  to: { name: string },
  items: DigestItem[],
  ctx: MailContext,
): EmailContent {
  const todo = items.filter((i) => i.action);
  return {
    subject: `Your daily summary: ${todo.length ? `${todo.length} need${todo.length === 1 ? 's' : ''} you, ` : ''}${items.length} update${items.length === 1 ? '' : 's'}`,
    greetingName: to.name,
    summary: `Here is what happened in HMP since yesterday’s summary.`,
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

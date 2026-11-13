import { prisma } from '@hmp/db';

/**
 * v1.4.3 (H29) — every email's built-in wording: subject, one-line summary and "what you need to do", with
 * {{placeholders}}. Admin → Notifications can change these three per email; an edit is stored as a
 * NotificationTemplate row keyed "email:<key>" (the seed never touches those keys), and "Back to the original
 * wording" deletes it. Everything else in an email (the due date, button, details, people, history, footer)
 * is fixed, so an edit can't break an email.
 */

export const PLACEHOLDERS: Record<string, string> = {
  name: 'the reader’s name',
  course: 'course code and title',
  courseCode: 'course code',
  courseTitle: 'course title',
  semester: 'semester, e.g. Sem-I 2026-27',
  programme: 'programme code',
  refNo: 'HMP reference',
  actor: 'who did it',
  faculty: 'the faculty on the handout',
  reviewer: 'who sent it back',
  step: 'the current step',
  dueDate: 'the current step’s due date',
  daysLeft: '“3 days left” / “2 days overdue”',
  holders: 'who has the step now',
  next: 'what happens next',
  role: 'the role handed over',
  previous: 'who had it before',
  reason: 'the reason given',
  person: 'the colleague who is away',
  until: 'the last day away',
  by: 'who made the change',
};

const REQUEST = [
  'name',
  'course',
  'courseCode',
  'courseTitle',
  'semester',
  'programme',
  'refNo',
  'actor',
  'faculty',
  'step',
  'dueDate',
  'daysLeft',
] as const;

export interface CatalogueEntry {
  key: string;
  /** "Sent back for changes" */
  label: string;
  /** "Faculty" — who gets this version. */
  to: string;
  /** Asks the reader to act (shows the due date, "What you need to do"). */
  needed: boolean;
  button: string;
  subject: string;
  summary: string;
  action: string;
  tokens: readonly string[];
  /** Built from a request (the preview needs one). */
  request: boolean;
}

const e = (
  key: string,
  label: string,
  to: string,
  needed: boolean,
  button: string,
  subject: string,
  summary: string,
  action: string,
  extra: string[] = [],
  request = true,
): CatalogueEntry => ({
  key,
  label,
  to,
  needed,
  button,
  subject,
  summary,
  action,
  tokens: request ? [...REQUEST, ...extra] : ['name', ...extra],
  request,
});

const TAG = '{{course}} ({{semester}})';

export const CATALOGUE: CatalogueEntry[] = [
  e(
    'request.new:HOG',
    'New request',
    'Head of Group',
    true,
    'Allocate now',
    `Action needed: allocate ${TAG}`,
    '{{actor}} (Instruction Cell) has started the handout request for {{course}}, {{semester}}.',
    'Choose the Programme Committee member, the faculty and the SME for this course.',
  ),
  e(
    'allocated:PC',
    'Allocated — confirm',
    'Programme Committee',
    true,
    'Check the allocation',
    `Action needed: confirm the allocation for ${TAG}`,
    '{{actor}} has allocated {{faculty}} to write the handout for {{course}}.',
    'Check the allocation and confirm it, or send it back to the Head of Group with a reason.',
  ),
  e(
    'allocated:FACULTY',
    'Allocated',
    'Faculty',
    false,
    'Open in HMP',
    `You are allocated: ${TAG}`,
    '{{actor}} has allocated you to write the handout for {{course}}.',
    'The Programme Committee confirms the allocation next. You will get an email when you can start writing.',
  ),
  e(
    'allocation-sent-back:HOG',
    'Allocation sent back',
    'Head of Group',
    true,
    'Allocate again',
    `Action needed: allocate again ${TAG}`,
    '{{reviewer}} sent the allocation for {{course}} back to you.',
    'Read the reason below and allocate again.',
    ['reviewer'],
  ),
  e(
    'allocation-sent-back:FACULTY',
    'Allocation withdrawn',
    'Faculty',
    false,
    'Open in HMP',
    `Allocation withdrawn: ${TAG}`,
    'The allocation for {{course}} was sent back to the Head of Group, so you are no longer allocated to it.',
    'Nothing to do. If you are allocated again, you will get a new email.',
  ),
  e(
    'assigned:FACULTY',
    'Confirmed — start writing',
    'Faculty',
    true,
    'Start writing',
    `Action needed: write the handout for ${TAG}`,
    'You are confirmed as faculty for {{course}}, {{semester}}.',
    'Accept the assignment and write the handout. It starts from last year’s published handout where there is one. When it is ready, submit it for SME review.',
  ),
  e(
    'sme-review:SME',
    'Sent for SME review',
    'SME',
    true,
    'Review the handout',
    `Action needed: review ${TAG}`,
    '{{actor}} has submitted the handout for {{course}} for your review.',
    'Review the handout. Approve it, or send it back to the faculty with comments.',
  ),
  e(
    'sme-review:INFO',
    'Sent for SME review',
    'Instruction Cell',
    false,
    'Open in HMP',
    `Sent for SME review: ${TAG}`,
    '{{actor}} has sent the handout for {{course}} to the SME.',
    'The SME reviews it next.',
  ),
  e(
    'pc-review:PC',
    'SME approved — PC review',
    'Programme Committee',
    true,
    'Review the handout',
    `Action needed: review ${TAG}`,
    'The handout for {{course}} is ready for your review. The SME ({{actor}}) approved it.',
    'Review the handout. Approve it for the Head of Group, or send it back to the faculty with comments.',
  ),
  e(
    'submitted:PC',
    'Submitted — PC review',
    'Programme Committee',
    true,
    'Review the handout',
    `Action needed: review ${TAG}`,
    'The handout for {{course}} is ready for your review.',
    'Review the handout. Approve it for the Head of Group, or send it back to the faculty with comments.',
  ),
  e(
    'sme-approved:FACULTY',
    'SME approved',
    'Faculty',
    false,
    'Open in HMP',
    `SME approved: ${TAG}`,
    'The SME ({{actor}}) approved the handout for {{course}}. It is with the Programme Committee now.',
    'Nothing to do now. You will hear when it is approved or if changes are needed.',
  ),
  e(
    'sme-approved:INFO',
    'SME approved',
    'Instruction Cell',
    false,
    'Open in HMP',
    `SME approved: ${TAG}`,
    'The SME ({{actor}}) approved the handout for {{course}}. It is with the Programme Committee now.',
    'The Programme Committee reviews it next.',
  ),
  e(
    'sent-back:FACULTY',
    'Sent back for changes',
    'Faculty',
    true,
    'Make the changes',
    `Changes needed: ${TAG}`,
    '{{reviewer}} sent the handout for {{course}} back to you for changes.',
    'Read the comments below, make the changes and submit it again.',
    ['reviewer'],
  ),
  e(
    'sent-back:INFO',
    'Sent back for changes',
    'Instruction Cell',
    false,
    'Open in HMP',
    `Sent back for changes: ${TAG}`,
    '{{reviewer}} sent the handout for {{course}} back to the faculty.',
    'The faculty makes the changes and submits again.',
    ['reviewer'],
  ),
  e(
    'final-approval:HOG',
    'PC approved — final approval',
    'Head of Group',
    true,
    'Review the handout',
    `Action needed: give final approval to ${TAG}`,
    'The Programme Committee ({{actor}}) approved the handout for {{course}}.',
    'Give the final approval, or send it back with comments.',
  ),
  e(
    'approved:IC',
    'Approved — publish',
    'Instruction Cell',
    true,
    'Publish to Taxila',
    `Action needed: publish ${TAG}`,
    '{{actor}} gave the final approval for {{course}}.',
    'Publish the handout to Taxila.',
  ),
  e(
    'approved:INFO',
    'Approved',
    'Faculty (and IC when auto-publish is on)',
    false,
    'Open in HMP',
    `Approved: ${TAG}`,
    '{{actor}} gave the final approval for the handout for {{course}}.',
    '{{next}}',
    ['next'],
  ),
  e(
    'rejected:INFO',
    'Rejected',
    'Faculty, Instruction Cell',
    false,
    'Open in HMP',
    `Rejected: ${TAG}`,
    '{{actor}} rejected the handout for {{course}}.',
    'The request is closed. The Instruction Cell can start a new one if needed.',
  ),
  e(
    'published:INFO',
    'Published',
    'Faculty, Instruction Cell',
    false,
    'Open in HMP',
    `Published: ${TAG}`,
    'The handout for {{course}} is published on Taxila.',
    'Nothing to do. Students can see it on the course page.',
  ),
  e(
    'archived:INFO',
    'Archived',
    'Instruction Cell',
    false,
    'Open in HMP',
    `Archived: ${TAG}`,
    '{{actor}} archived the request for {{course}}.',
    'Nothing to do.',
  ),
  e(
    'reminder.due-soon',
    'Due soon',
    'Whoever has the step',
    true,
    'Open the request',
    'Due soon: {{step}} for {{course}} ({{semester}}) — due {{dueDate}}',
    '“{{step}}” for {{course}} is due on {{dueDate}}.',
    'Please finish this step by the due date.',
  ),
  e(
    'reminder.overdue',
    'Overdue',
    'Whoever has the step',
    true,
    'Open the request',
    'Overdue: {{step}} for {{course}} ({{semester}}) — {{daysLeft}}',
    '“{{step}}” for {{course}} is {{daysLeft}}.',
    'Please finish this step as soon as you can. If you cannot, tell the Head of Group so it can be handed over or the date changed.',
  ),
  e(
    'escalation:HOG',
    'Escalation',
    'Head of Group',
    true,
    'Open the request',
    'Overdue: {{holders}} — {{step}}, {{course}} ({{semester}}), {{daysLeft}}',
    '“{{step}}” for {{course}} is {{daysLeft}}. It is with {{holders}}.',
    'Please follow up with {{holders}}. If the work should move to someone else, use Hand over on the request page. If the date is wrong, change it there (with a reason).',
    ['holders'],
  ),
  e(
    'escalation:IC',
    'Escalation',
    'Instruction Cell',
    true,
    'Open the request',
    'Overdue: {{holders}} — {{step}}, {{course}} ({{semester}}), {{daysLeft}}',
    '“{{step}}” for {{course}} is {{daysLeft}}. It is with {{holders}}.',
    'Please follow up with {{holders}} and the Head of Group. If the work should move to someone else, use Hand over on the request page. If the date is wrong, change it there (with a reason).',
    ['holders'],
  ),
  e(
    'handover:NEW',
    'Handed over to you',
    'The new person',
    true,
    'Open the request',
    `Action needed: you are now the {{role}} for ${TAG}`,
    '{{actor}} made you the {{role}} for {{course}}.',
    'Pick up the work from where it is now. The reason and the previous person are below.',
    ['role', 'previous', 'reason'],
  ),
  e(
    'handover:PREVIOUS',
    'Handed over',
    'The previous person',
    false,
    'Open in HMP',
    `Handed over: ${TAG}`,
    '{{actor}} handed your work as {{role}} for {{course}} to someone else.',
    'Nothing to do. You no longer have this step.',
    ['role', 'previous', 'reason'],
  ),
  e(
    'comment.mention',
    '@mention',
    'The person mentioned',
    true,
    'Reply',
    '{{actor}} mentioned you: {{course}} ({{semester}})',
    '{{actor}} mentioned you in a comment on the handout for {{course}}.',
    'Read the comment below and reply if needed.',
  ),
  e(
    'comment.reply',
    'Reply in your thread',
    'People in the thread',
    false,
    'Reply',
    'New reply: {{course}} ({{semester}})',
    '{{actor}} replied in a comment thread you are in, on the handout for {{course}}.',
    'Read the reply below. Reply if needed.',
  ),
  e(
    'welcome',
    'Welcome',
    'A new person',
    true,
    'Sign in to HMP',
    'Your HMP account is ready',
    '{{by}} has given you an account in HMP, the portal where BITS WILP course handouts are requested, written, reviewed and published to Taxila.',
    'Sign in with your BITS ID: press “Sign in with BITS” on the sign-in page.',
    ['by'],
    false,
  ),
  e(
    'welcome.password',
    'Welcome (no BITS sign-in yet)',
    'A new person',
    true,
    'Sign in to HMP',
    'Your HMP account is ready',
    '{{by}} has given you an account in HMP, the portal where BITS WILP course handouts are requested, written, reviewed and published to Taxila.',
    'Sign in with your email address. The HMP administrator will give you your password separately.',
    ['by'],
    false,
  ),
  e(
    'access.changed',
    'Roles changed',
    'The person',
    false,
    'Open HMP',
    'Your HMP access has changed',
    '{{by}} changed your HMP roles or department.',
    'Your menu changes the next time you open HMP. If this looks wrong, contact the Instruction Cell.',
    ['by'],
    false,
  ),
  e(
    'access.undone',
    'Roles change undone',
    'The person',
    false,
    'Open HMP',
    'A change to your HMP access was undone',
    '{{by}} undid the recent change to your HMP roles or department.',
    'Your menu changes the next time you open HMP. If this looks wrong, contact the Instruction Cell.',
    ['by'],
    false,
  ),
  e(
    'backup.named',
    'Back-up named',
    'The back-up',
    false,
    'Open My work',
    'You are {{person}}’s back-up until {{until}}',
    '{{person}} is away until {{until}} and named you as their back-up.',
    'Their work shows in your My work, marked “for {{person}} (away)”. You get their notices and can act for them. Nothing is moved: it is all theirs again when they are back.',
    ['person', 'until'],
    false,
  ),
  e(
    'backup.removed',
    'Back-up removed',
    'The back-up',
    false,
    'Open HMP',
    'You are no longer {{person}}’s back-up',
    'You are no longer the back-up for {{person}}.',
    'Nothing to do. Their work no longer shows in your My work.',
    ['person'],
    false,
  ),
  e(
    'taxila.run-finished',
    'Taxila run finished',
    'The IC who ran it',
    false,
    'Open the run',
    'Bulk publish to Taxila finished',
    'The bulk publish to Taxila you started has finished.',
    'Look at any course that was not published; each one has its reason.',
    [],
    false,
  ),
  e(
    'auto-publish.stopped',
    'Auto-publish stopped',
    'Instruction Cell',
    true,
    'Open the request',
    `Auto-publish needs you: ${TAG}`,
    'The handout for {{course}} was approved but not published to Taxila automatically.',
    'Publish it by hand from the request page, or fix the cause below and publish again.',
    ['reason'],
  ),
  e(
    'export-ready:IC',
    'Export ready (manual upload)',
    'Instruction Cell',
    true,
    'Open the request',
    `Action needed: upload to Taxila ${TAG}`,
    '{{actor}} exported the handout for {{course}} as a package for manual upload.',
    'Download it from HMP, upload it to Taxila, then mark it as published in HMP.',
  ),
  e(
    'manually-published:INFO',
    'Manually published',
    'Everyone on the request',
    false,
    'Open in HMP',
    `Published (manual upload): ${TAG}`,
    '{{actor}} confirmed that the handout for {{course}} was uploaded to Taxila by hand.',
    'Nothing to do. The request is now Published.',
  ),
];

export const CATALOGUE_BY_KEY = new Map(CATALOGUE.map((c) => [c.key, c]));

export const TEMPLATE_PREFIX = 'email:';

export interface WordingEdit {
  subject: string;
  summary: string;
  action: string;
  editedAt: Date | null;
  editedBy: string | null;
}

export type WordingEdits = Map<string, WordingEdit>;

/** The Admin's edits (catalogue key → wording). One query per dispatch. */
export async function loadWordingEdits(): Promise<WordingEdits> {
  const rows = await prisma.notificationTemplate.findMany({
    where: { key: { startsWith: TEMPLATE_PREFIX } },
    select: {
      key: true,
      subject: true,
      body: true,
      action: true,
      editedAt: true,
      editedById: true,
    },
  });
  const names = new Map(
    (
      await prisma.user.findMany({
        where: { id: { in: rows.map((r) => r.editedById).filter((x): x is string => !!x) } },
        select: { id: true, name: true },
      })
    ).map((u) => [u.id, u.name]),
  );
  return new Map(
    rows.map((r) => [
      r.key.slice(TEMPLATE_PREFIX.length),
      {
        subject: r.subject,
        summary: r.body,
        action: r.action ?? '',
        editedAt: r.editedAt,
        editedBy: r.editedById ? (names.get(r.editedById) ?? null) : null,
      },
    ]),
  );
}

/** Fills {{placeholders}}; one the email doesn't have becomes empty (never "{{x}}" in an email). */
export function fill(tpl: string, tokens: Record<string, string>): string {
  return tpl
    .replace(/\{\{(\w+)\}\}/g, (_, k: string) => tokens[k] ?? '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** Placeholders in `text` that this email doesn't have (refused when the Admin saves). */
export function unknownPlaceholders(entry: CatalogueEntry, text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\{\{(\w*)\}\}/g))
    if (!entry.tokens.includes(m[1]!)) out.add(m[1]!);
  // A single brace pair ({x}) or an unclosed one is almost always a typo.
  for (const m of text.matchAll(/\{(?!\{)(\w+)\}(?!\})/g)) out.add(`{${m[1]}}`);
  return [...out];
}

export interface Wording {
  entry: CatalogueEntry;
  subject: string;
  summary: string;
  action: string;
}

/** The words of one email: the Admin's edit where there is one (field by field), else the built-in wording. */
export function wordingFor(
  key: string,
  tokens: Record<string, string>,
  edits?: WordingEdits | null,
): Wording {
  const entry = CATALOGUE_BY_KEY.get(key);
  if (!entry) throw new Error(`unknown email ${key}`);
  const ed = edits?.get(key);
  return {
    entry,
    subject: fill(ed?.subject?.trim() || entry.subject, tokens),
    summary: fill(ed?.summary?.trim() || entry.summary, tokens),
    action: fill(ed?.action?.trim() || entry.action, tokens),
  };
}

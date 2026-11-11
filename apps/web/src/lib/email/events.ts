import { prisma, RoleName, type BitsHandoutV1 } from '@hmp/db';
import { taxilaConfigFromEnv, taxilaCourseUrl } from '@hmp/integrations';
import { dueWords, formatDueDay, STAGE_LABEL } from '../deadlines';
import { formatDateTime } from '../format-date';
import { compareHandouts } from '../handout-compare';
import { wordingFor, type WordingEdits } from './catalogue';
import type { EmailContent, EmailQuote, EmailRow } from './layout';
import { detailRows, peopleRows, recentSteps, type RequestFacts } from './request-facts';

/**
 * v1.4.3 (§G) — the emails about one request. `requestEmail` puts any catalogue email together from the
 * request's facts; `transitionEmail` picks the right one for a workflow step and the reader's role, with the
 * "what happened" box for that step. `loadEventExtra` loads what only some steps need (the reviewer's
 * comments, what changed since the last reviewed version, the Taxila publish).
 */

export type MailEvent =
  | 'REQUEST_INITIATED'
  | 'FACULTY_ALLOCATED'
  | 'ASSIGNED'
  | 'ALLOCATION_REJECTED'
  | 'EDIT_STARTED'
  | 'SUBMITTED'
  | 'SME_REVIEW_REQUESTED'
  | 'SME_APPROVED'
  | 'SME_REVERTED'
  | 'REVIEW_REWORK'
  | 'REVIEW_APPROVED'
  | 'FINAL_APPROVED'
  | 'FINAL_REJECTED'
  | 'PUBLISHED'
  | 'ARCHIVED';

export interface MailRecipient {
  id: string;
  name: string;
  email: string;
  /** The role this email is about (their link and "why you got this"). */
  role: RoleName;
  /** Set when they get a copy as an away colleague's back-up: that colleague's name. */
  backupFor?: string | null;
}

export interface EventExtra {
  /** The decision that caused the step (sent back, rejected …) with its full comments. */
  decision: { by: string; stage: string; at: Date; comments: string | null } | null;
  /** Sections changed since the last version a reviewer decided on; first = no earlier one. */
  changes: { first: boolean; lines: string[] } | null;
  published: {
    course: string | null;
    url: string | null;
    fileName: string | null;
    at: Date;
  } | null;
  autoPublish: boolean;
}

export const NO_EXTRA: EventExtra = {
  decision: null,
  changes: null,
  published: null,
  autoPublish: false,
};

export interface MailContext {
  actorName: string;
  now: Date;
  /** Absolute URL builder (APP_BASE_URL). */
  url: (path: string) => string;
  footer: { help: string | null; replyTo: string | null };
  logoUrl: string | null;
  edits?: WordingEdits | null;
}

export const ROLE_WHY: Partial<Record<RoleName, string>> = {
  [RoleName.HOG]: 'You get this because you are the Head of Group for this request.',
  [RoleName.PROGRAMME_COMMITTEE]:
    'You get this because you are the Programme Committee member for this request.',
  [RoleName.FACULTY]: 'You get this because you are a faculty member on this handout.',
  [RoleName.SME]: 'You get this because you are the SME (subject expert) for this handout.',
  [RoleName.INSTRUCTION_CELL]: 'You get this because you are in the Instruction Cell.',
  [RoleName.ADMIN]: 'You get this because you are an HMP administrator.',
};

const PAGE: Partial<Record<RoleName, (id: string) => string>> = {
  [RoleName.INSTRUCTION_CELL]: (id) => `/ic/requests/${id}`,
  [RoleName.HOG]: (id) => `/hog/requests/${id}`,
  [RoleName.PROGRAMME_COMMITTEE]: (id) => `/pc/requests/${id}`,
  [RoleName.FACULTY]: (id) => `/faculty/assignments/${id}`,
  [RoleName.SME]: (id) => `/sme/review/${id}`,
  [RoleName.ADMIN]: (id) => `/ic/requests/${id}`,
};

export function pageFor(role: RoleName, requestId: string): string {
  return (PAGE[role] ?? PAGE[RoleName.INSTRUCTION_CELL]!)(requestId);
}

const STAGE_WORD: Record<string, string> = {
  HOG_REVIEW: 'the Head of Group',
  SME_REVIEW: 'the SME',
  PC_REVIEW: 'the Programme Committee',
  HOG_FINAL: 'the Head of Group (final approval)',
  IC_PUBLISH: 'the Instruction Cell',
};

// ---- extra facts ------------------------------------------------------------------------------

function changeLines(before: unknown, after: unknown): string[] {
  try {
    const cmp = compareHandouts(before as BitsHandoutV1, after as BitsHandoutV1);
    return cmp.sections
      .filter((s) => s.changed > 0)
      .map((s) => {
        const n = (k: string) => s.rows.filter((r) => r.kind === k).length;
        const parts = [
          n('changed') ? `${n('changed')} changed` : null,
          n('added') ? `${n('added')} added` : null,
          n('removed') ? `${n('removed')} removed` : null,
        ].filter(Boolean);
        return `${s.title}: ${parts.join(', ')}`;
      });
  } catch {
    return [];
  }
}

export async function loadEventExtra(event: MailEvent, requestId: string): Promise<EventExtra> {
  const extra: EventExtra = { ...NO_EXTRA };

  if (
    event === 'SME_REVERTED' ||
    event === 'REVIEW_REWORK' ||
    event === 'FINAL_REJECTED' ||
    event === 'ALLOCATION_REJECTED'
  ) {
    const a = await prisma.approval.findFirst({
      where: { requestId, decision: { in: ['REWORK', 'REJECTED'] } },
      orderBy: { createdAt: 'desc' },
      select: {
        stage: true,
        comments: true,
        createdAt: true,
        decidedAt: true,
        reviewer: { select: { name: true } },
      },
    });
    if (a)
      extra.decision = {
        by: a.reviewer.name,
        stage: a.stage,
        at: a.decidedAt ?? a.createdAt,
        comments: a.comments,
      };
  }

  if (event === 'SME_REVIEW_REQUESTED' || event === 'SME_APPROVED' || event === 'SUBMITTED') {
    const handout = await prisma.handout.findUnique({
      where: { requestId },
      select: { currentVersion: { select: { id: true, data: true, createdAt: true } } },
    });
    const cur = handout?.currentVersion;
    if (cur) {
      // "Since the last version": the version that was current when a reviewer last decided.
      const lastDecision = await prisma.approval.findFirst({
        where: {
          requestId,
          stage: { in: ['SME_REVIEW', 'PC_REVIEW', 'HOG_FINAL'] },
          decision: { in: ['APPROVED', 'REWORK', 'REJECTED'] },
          createdAt: { lte: cur.createdAt },
        },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      const prev = lastDecision
        ? await prisma.handoutVersion.findFirst({
            where: {
              handout: { requestId },
              createdAt: { lte: lastDecision.createdAt },
              id: { not: cur.id },
            },
            orderBy: { createdAt: 'desc' },
            select: { data: true },
          })
        : null;
      extra.changes =
        prev?.data && cur.data
          ? { first: false, lines: changeLines(prev.data, cur.data) }
          : { first: true, lines: [] };
    }
  }

  if (event === 'PUBLISHED') {
    const item = await prisma.taxilaPublishItem.findFirst({
      where: { requestId, status: 'PUBLISHED' },
      orderBy: { updatedAt: 'desc' },
      select: { courseFullname: true, taxilaCourseId: true, fileName: true, updatedAt: true },
    });
    const cfg = taxilaConfigFromEnv();
    extra.published = item
      ? {
          course: item.courseFullname,
          url: cfg && item.taxilaCourseId ? taxilaCourseUrl(cfg, item.taxilaCourseId) : null,
          fileName: item.fileName,
          at: item.updatedAt,
        }
      : { course: null, url: null, fileName: null, at: new Date() };
  }

  if (event === 'FINAL_APPROVED') {
    const cfg = await prisma.workflowConfig.findUnique({
      where: { key: 'default' },
      select: { autoPublish: true },
    });
    extra.autoPublish = !!cfg?.autoPublish;
  }
  return extra;
}

// ---- one request email ------------------------------------------------------------------------

export function requestTokens(
  f: RequestFacts,
  to: { name: string },
  ctx: Pick<MailContext, 'actorName' | 'now'>,
  extra: Record<string, string> = {},
): Record<string, string> {
  const due = f.current;
  return {
    name: to.name,
    course: `${f.course.code} ${f.course.title}`,
    courseCode: f.course.code,
    courseTitle: f.course.title,
    semester: f.semester.name,
    programme: f.programme.code,
    refNo: f.refNo,
    actor: ctx.actorName,
    faculty: f.people.faculty.map((p) => p.name).join(', ') || 'the faculty',
    step: due ? STAGE_LABEL[due.stage] : '',
    dueDate: due ? formatDueDay(due.dueAt) : '',
    daysLeft: due ? dueWords(due.dueAt, ctx.now).text : '',
    ...extra,
  };
}

/** Any catalogue email about a request, for one reader. */
export function requestEmail(
  key: string,
  f: RequestFacts,
  to: MailRecipient,
  ctx: MailContext,
  o: {
    tokens?: Record<string, string>;
    happened?: EmailContent['happened'];
    /** Appended to the page link, e.g. "#comments". */
    anchor?: string;
    why?: string;
    timeline?: number;
    /** false: the subject already says when (reminders). */
    subjectDue?: boolean;
  } = {},
): EmailContent {
  const w = wordingFor(key, requestTokens(f, to, ctx, o.tokens), ctx.edits);
  const due = w.entry.needed && f.current ? f.current : null;
  const dueText = due ? dueWords(due.dueAt, ctx.now) : null;
  // Relative links inside "what happened" (the PDF) become absolute.
  const happened = o.happened
    ? {
        ...o.happened,
        rows: o.happened.rows?.map((r) =>
          r.href?.startsWith('/') ? { ...r, href: ctx.url(r.href) } : r,
        ),
      }
    : null;
  return {
    subject:
      due && o.subjectDue !== false && !w.subject.includes(formatDueDay(due.dueAt))
        ? `${w.subject} — due ${formatDueDay(due.dueAt)}`
        : w.subject,
    greetingName: to.name,
    summary: to.backupFor
      ? `${w.summary} (You get this as ${to.backupFor}’s back-up while they are away.)`
      : w.summary,
    action: {
      needed: w.entry.needed,
      text: w.action,
      due:
        due && dueText
          ? {
              day: formatDueDay(due.dueAt),
              words: `${STAGE_LABEL[due.stage]} · ${dueText.text}`,
              tone: dueText.tone,
            }
          : null,
    },
    button: { label: w.entry.button, url: ctx.url(`${pageFor(to.role, f.id)}${o.anchor ?? ''}`) },
    happened,
    details: detailRows(f),
    people: peopleRows(f),
    timeline: recentSteps(f, o.timeline ?? 5),
    footer: {
      why: to.backupFor
        ? `You get this because you are ${to.backupFor}’s back-up while they are away.`
        : (o.why ?? ROLE_WHY[to.role] ?? 'You get this because you are on this request.'),
      settingsUrl: ctx.url('/settings'),
      help: ctx.footer.help,
      replyTo: ctx.footer.replyTo,
    },
    logoUrl: ctx.logoUrl,
  };
}

// ---- workflow steps ---------------------------------------------------------------------------

function decisionQuote(x: EventExtra): EmailQuote[] {
  const d = x.decision;
  if (!d) return [];
  return [
    {
      by: `${d.by} (${STAGE_WORD[d.stage] ?? d.stage})`,
      when: formatDateTime(d.at),
      text: d.comments?.trim() || '(No comments were written.)',
    },
  ];
}

function changesBlock(f: RequestFacts, x: EventExtra): EmailContent['happened'] {
  const rows: EmailRow[] = [];
  if (f.version) rows.push({ label: 'Version', value: String(f.version.no) });
  if (f.version?.note) rows.push({ label: 'Faculty’s note', value: f.version.note });
  const c = x.changes;
  return {
    title: 'What changed',
    rows,
    bullets: !c
      ? []
      : c.first
        ? ['This is the first version sent for review.']
        : c.lines.length
          ? c.lines
          : ['No content changes since the last version that was reviewed.'],
  };
}

/** Which catalogue email a step sends to a reader in `role`, and its "what happened" box. */
export function transitionChoice(
  event: MailEvent,
  role: RoleName,
  f: RequestFacts,
  x: EventExtra,
  actorName: string,
): { key: string; tokens?: Record<string, string>; happened?: EmailContent['happened'] } | null {
  const isFaculty = role === RoleName.FACULTY;
  const reviewer = { reviewer: x.decision?.by ?? actorName };
  switch (event) {
    case 'REQUEST_INITIATED':
      return { key: 'request.new:HOG' };
    case 'FACULTY_ALLOCATED':
      return isFaculty
        ? { key: 'allocated:FACULTY' }
        : {
            key: 'allocated:PC',
            happened: {
              title: 'The allocation',
              rows: [
                { label: 'Faculty', value: f.people.faculty.map((p) => p.name).join(', ') || '—' },
                ...(f.people.sme ? [{ label: 'SME', value: f.people.sme.name }] : []),
                { label: 'Allocated by', value: actorName },
              ],
            },
          };
    case 'ASSIGNED':
      return { key: 'assigned:FACULTY' };
    case 'ALLOCATION_REJECTED':
      return isFaculty
        ? { key: 'allocation-sent-back:FACULTY' }
        : {
            key: 'allocation-sent-back:HOG',
            tokens: reviewer,
            happened: { title: 'The reason', quotes: decisionQuote(x) },
          };
    case 'SME_REVIEW_REQUESTED':
      return {
        key: role === RoleName.SME ? 'sme-review:SME' : 'sme-review:INFO',
        happened: changesBlock(f, x),
      };
    case 'SUBMITTED':
      return role === RoleName.PROGRAMME_COMMITTEE
        ? { key: 'submitted:PC', happened: changesBlock(f, x) }
        : null;
    case 'SME_APPROVED':
      return role === RoleName.PROGRAMME_COMMITTEE
        ? { key: 'pc-review:PC', happened: changesBlock(f, x) }
        : { key: isFaculty ? 'sme-approved:FACULTY' : 'sme-approved:INFO' };
    case 'SME_REVERTED':
    case 'REVIEW_REWORK':
      return {
        key: isFaculty ? 'sent-back:FACULTY' : 'sent-back:INFO',
        tokens: reviewer,
        happened: { title: 'The comments', quotes: decisionQuote(x) },
      };
    case 'REVIEW_APPROVED':
      return { key: 'final-approval:HOG' };
    case 'FINAL_APPROVED':
      return role === RoleName.INSTRUCTION_CELL && !x.autoPublish
        ? { key: 'approved:IC' }
        : {
            key: 'approved:INFO',
            tokens: {
              next: x.autoPublish
                ? 'HMP publishes it to Taxila automatically after a check. The Instruction Cell is told if anything stops it.'
                : 'The Instruction Cell publishes it to Taxila next.',
            },
          };
    case 'FINAL_REJECTED':
      return {
        key: 'rejected:INFO',
        happened: { title: 'The reason', quotes: decisionQuote(x) },
      };
    case 'PUBLISHED': {
      const p = x.published;
      const rows: EmailRow[] = [
        ...(p?.course
          ? [{ label: 'Taxila course', value: p.course, ...(p.url ? { href: p.url } : {}) }]
          : []),
        ...(p?.fileName ? [{ label: 'File', value: p.fileName }] : []),
        ...(p ? [{ label: 'Published', value: formatDateTime(p.at) }] : []),
        {
          label: 'PDF',
          value: 'Download the handout PDF',
          href: `/api/handouts/${f.id}/export/pdf`,
        },
      ];
      return { key: 'published:INFO', happened: { title: 'Where it is', rows } };
    }
    case 'ARCHIVED':
      return { key: 'archived:INFO' };
    case 'EDIT_STARTED':
      return null;
  }
}

/** The email one person gets for a workflow step; null when the step sends them none. */
export function transitionEmail(
  event: MailEvent,
  f: RequestFacts,
  to: MailRecipient,
  x: EventExtra,
  ctx: MailContext,
): EmailContent | null {
  const c = transitionChoice(event, to.role, f, x, ctx.actorName);
  if (!c) return null;
  return requestEmail(c.key, f, to, ctx, { tokens: c.tokens, happened: c.happened });
}

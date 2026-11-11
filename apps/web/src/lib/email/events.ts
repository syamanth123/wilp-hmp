import { prisma, RoleName, type BitsHandoutV1 } from '@hmp/db';
import { taxilaConfigFromEnv, taxilaCourseUrl } from '@hmp/integrations';
import { dueWords, formatDueDay, STAGE_LABEL } from '../deadlines';
import { formatDateTime } from '../format-date';
import { compareHandouts } from '../handout-compare';
import type { EmailContent, EmailQuote, EmailRow } from './layout';
import { detailRows, peopleRows, recentSteps, type RequestFacts } from './request-facts';

/**
 * v1.4.3 (§G) — the words of each workflow email, per event and per recipient role. The facts come from
 * request-facts.ts; `loadEventExtra` adds what only some events need (the reviewer's comments, what changed
 * since the last version, the Taxila publish). Pure apart from loadEventExtra.
 */

export type MailEvent =
  | 'REQUEST_INITIATED'
  | 'FACULTY_ALLOCATED'
  | 'ASSIGNED'
  | 'ALLOCATION_REJECTED'
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
  /** Set when they get a copy as an away colleague's back-up. */
  backupFor?: string | null;
}

export interface EventExtra {
  /** The decision that caused the event (sent back, rejected …) with its full comments. */
  decision: { by: string; stage: string; at: Date; comments: string | null } | null;
  /** Sections changed since the last version that was sent for review; null = first version. */
  changes: { first: boolean; lines: string[] } | null;
  published: {
    course: string | null;
    url: string | null;
    fileName: string | null;
    at: Date;
  } | null;
  autoPublish: boolean;
}

export interface MailContext {
  actorName: string;
  now: Date;
  /** Absolute URL builder (APP_BASE_URL). */
  url: (path: string) => string;
  footer: { help: string | null; replyTo: string | null };
  logoUrl: string | null;
}

const ROLE_WHY: Partial<Record<RoleName, string>> = {
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
  const extra: EventExtra = { decision: null, changes: null, published: null, autoPublish: false };

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
          decision: { not: 'PENDING' },
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

// ---- the words --------------------------------------------------------------------------------

interface Words {
  subject: string;
  summary: string;
  needed: boolean;
  action: string;
  /** Show the current step's due date (for the person who has to act). */
  showDue: boolean;
  button: string;
  happened?: EmailContent['happened'];
}

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
  if (f.version?.note) rows.push({ label: "Faculty's note", value: f.version.note });
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

function words(
  event: MailEvent,
  f: RequestFacts,
  to: MailRecipient,
  x: EventExtra,
  actor: string,
): Words | null {
  const course = `${f.course.code} ${f.course.title}`;
  const tag = `${course} (${f.semester.name})`;
  const role = to.role;
  const isFaculty = role === RoleName.FACULTY;
  const faculty = f.people.faculty.map((p) => p.name).join(', ') || 'the faculty';
  const info = (
    subject: string,
    summary: string,
    action: string,
    extra?: Partial<Words>,
  ): Words => ({
    subject: `${subject}: ${tag}`,
    summary,
    needed: false,
    action,
    showDue: false,
    button: 'Open in HMP',
    ...extra,
  });
  const act = (verb: string, summary: string, action: string, extra?: Partial<Words>): Words => ({
    subject: `Action needed: ${verb} ${tag}`,
    summary,
    needed: true,
    action,
    showDue: true,
    button: 'Open the request',
    ...extra,
  });

  switch (event) {
    case 'REQUEST_INITIATED':
      return act(
        'allocate',
        `${actor} (Instruction Cell) has started the handout request for ${course}, ${f.semester.name}.`,
        'Choose the Programme Committee member, the faculty and the SME for this course.',
        { button: 'Allocate now' },
      );
    case 'FACULTY_ALLOCATED':
      return isFaculty
        ? info(
            'You are allocated',
            `${actor} has allocated you to write the handout for ${course}.`,
            'The Programme Committee confirms the allocation next. You will get an email when you can start writing.',
          )
        : act(
            'confirm the allocation for',
            `${actor} has allocated ${faculty} to write the handout for ${course}.`,
            'Check the allocation and confirm it, or send it back to the Head of Group with a reason.',
            {
              button: 'Check the allocation',
              happened: {
                title: 'The allocation',
                rows: [
                  { label: 'Faculty', value: faculty },
                  ...(f.people.sme ? [{ label: 'SME', value: f.people.sme.name }] : []),
                  { label: 'Allocated by', value: actor },
                ],
              },
            },
          );
    case 'ASSIGNED':
      return act(
        'write the handout for',
        `You are confirmed as faculty for ${course}, ${f.semester.name}.`,
        'Accept the assignment and write the handout. It starts from last year’s published handout where there is one. When it is ready, submit it for SME review.',
        { button: 'Start writing' },
      );
    case 'ALLOCATION_REJECTED':
      return isFaculty
        ? info(
            'Allocation withdrawn',
            `The allocation for ${course} was sent back to the Head of Group, so you are no longer allocated to it.`,
            'Nothing to do. If you are allocated again, you will get a new email.',
          )
        : act(
            'allocate again',
            `${actor} sent the allocation for ${course} back to you.`,
            'Read the reason below and allocate again.',
            {
              button: 'Allocate again',
              happened: { title: 'The reason', quotes: decisionQuote(x) },
            },
          );
    case 'SME_REVIEW_REQUESTED':
      return role === RoleName.SME
        ? act(
            'review',
            `${actor} has submitted the handout for ${course} for your review.`,
            'Review the handout. Approve it, or send it back to the faculty with comments.',
            { button: 'Review the handout', happened: changesBlock(f, x) },
          )
        : info(
            'Sent for SME review',
            `${actor} has sent the handout for ${course} to the SME.`,
            'The SME reviews it next.',
            {
              happened: changesBlock(f, x),
            },
          );
    case 'SUBMITTED':
    case 'SME_APPROVED':
      return role === RoleName.PROGRAMME_COMMITTEE
        ? act(
            'review',
            `The handout for ${course} is ready for your review${event === 'SME_APPROVED' ? ` (the SME, ${actor}, approved it)` : ''}.`,
            'Review the handout. Approve it for the Head of Group, or send it back to the faculty with comments.',
            { button: 'Review the handout', happened: changesBlock(f, x) },
          )
        : info(
            'SME approved',
            `The SME (${actor}) approved the handout for ${course}. It is with the Programme Committee now.`,
            isFaculty
              ? 'Nothing to do now. You will hear when it is approved or if changes are needed.'
              : 'The Programme Committee reviews it next.',
          );
    case 'SME_REVERTED':
    case 'REVIEW_REWORK':
      return isFaculty
        ? act(
            'make changes to',
            `${x.decision?.by ?? actor} sent the handout for ${course} back to you for changes.`,
            'Read the comments below, make the changes and submit it again.',
            {
              subject: `Changes needed: ${tag}`,
              button: 'Make the changes',
              happened: { title: 'The comments', quotes: decisionQuote(x) },
            },
          )
        : info(
            'Sent back for changes',
            `${x.decision?.by ?? actor} sent the handout for ${course} back to the faculty.`,
            'The faculty makes the changes and submits again.',
            {
              happened: { title: 'The comments', quotes: decisionQuote(x) },
            },
          );
    case 'REVIEW_APPROVED':
      return act(
        'give final approval to',
        `The Programme Committee (${actor}) approved the handout for ${course}.`,
        'Give the final approval, or send it back with comments.',
        { button: 'Review the handout' },
      );
    case 'FINAL_APPROVED': {
      const next = x.autoPublish
        ? 'HMP publishes it to Taxila automatically after a check. The Instruction Cell is told if anything stops it.'
        : 'The Instruction Cell publishes it to Taxila next.';
      return role === RoleName.INSTRUCTION_CELL && !x.autoPublish
        ? act(
            'publish',
            `${actor} gave the final approval for ${course}.`,
            'Publish the handout to Taxila.',
            {
              button: 'Publish to Taxila',
            },
          )
        : info('Approved', `${actor} gave the final approval for the handout for ${course}.`, next);
    }
    case 'FINAL_REJECTED':
      return info(
        'Rejected',
        `${actor} rejected the handout for ${course}.`,
        'The request is closed. The Instruction Cell can start a new one if needed.',
        {
          happened: { title: 'The reason', quotes: decisionQuote(x) },
        },
      );
    case 'PUBLISHED': {
      const p = x.published;
      const rows: EmailRow[] = [
        ...(p?.course
          ? [{ label: 'Taxila course', value: p.course, ...(p.url ? { href: p.url } : {}) }]
          : []),
        ...(p?.fileName ? [{ label: 'File', value: p.fileName }] : []),
        { label: 'Published', value: p ? formatDateTime(p.at) : '' },
        {
          label: 'PDF',
          value: 'Download the handout PDF',
          href: `/api/handouts/${f.id}/export/pdf`,
        },
      ];
      return info(
        'Published',
        `The handout for ${course} is published on Taxila.`,
        'Nothing to do. Students can see it on the course page.',
        {
          happened: { title: 'Where it is', rows },
        },
      );
    }
    case 'ARCHIVED':
      return info('Archived', `${actor} archived the request for ${course}.`, 'Nothing to do.');
  }
}

/** The email one person gets for a workflow event; null when the event sends no email. */
export function transitionEmail(
  event: MailEvent,
  f: RequestFacts,
  to: MailRecipient,
  x: EventExtra,
  ctx: MailContext,
): EmailContent | null {
  const w = words(event, f, to, x, ctx.actorName);
  if (!w) return null;
  const due = w.showDue && f.current ? f.current : null;
  const dueText = due ? dueWords(due.dueAt, ctx.now) : null;
  const page = (PAGE[to.role] ?? PAGE[RoleName.INSTRUCTION_CELL]!)(f.id);
  // Relative links inside "what happened" (the PDF) become absolute.
  const happened = w.happened
    ? {
        ...w.happened,
        rows: w.happened.rows?.map((r) =>
          r.href?.startsWith('/') ? { ...r, href: ctx.url(r.href) } : r,
        ),
      }
    : null;
  return {
    subject: due ? `${w.subject} — due ${formatDueDay(due.dueAt)}` : w.subject,
    greetingName: to.name,
    summary: to.backupFor
      ? `${w.summary} (You get this as ${to.backupFor}’s back-up while they are away.)`
      : w.summary,
    action: {
      needed: w.needed,
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
    button: { label: w.button, url: ctx.url(page) },
    happened,
    details: detailRows(f),
    people: peopleRows(f),
    timeline: recentSteps(f),
    footer: {
      why: to.backupFor
        ? `You get this because you are ${to.backupFor}’s back-up while they are away.`
        : (ROLE_WHY[to.role] ?? 'You get this because you are on this request.'),
      settingsUrl: ctx.url('/settings'),
      help: ctx.footer.help,
      replyTo: ctx.footer.replyTo,
    },
    logoUrl: ctx.logoUrl,
  };
}

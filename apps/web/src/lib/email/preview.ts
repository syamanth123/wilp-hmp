import { prisma, RoleName } from '@hmp/db';
import { CATALOGUE_BY_KEY, type WordingEdit } from './catalogue';
import { loadMailContext } from './context';
import {
  loadEventExtra,
  requestEmail,
  transitionChoice,
  type MailEvent,
  type MailRecipient,
} from './events';
import type { EmailContent } from './layout';
import {
  autoPublishStoppedEmail,
  backupEmail,
  commentEmail,
  handoverEmail,
  reminderEmail,
  roleChangedEmail,
  taxilaRunEmail,
  welcomeEmail,
} from './other';
import { loadRequestFacts, type RequestFacts } from './request-facts';

/**
 * v1.4.3 (§4) — Admin → Notifications: any email as it would be sent, built from a real request and today's
 * data, with the wording being edited (before it is saved). Parts a request doesn't have yet (no comment, no
 * Taxila publish) use example text, marked "(example)".
 */

const EVENT_OF: Record<string, MailEvent> = {
  'request.new': 'REQUEST_INITIATED',
  allocated: 'FACULTY_ALLOCATED',
  'allocation-sent-back': 'ALLOCATION_REJECTED',
  assigned: 'ASSIGNED',
  'sme-review': 'SME_REVIEW_REQUESTED',
  'pc-review': 'SME_APPROVED',
  submitted: 'SUBMITTED',
  'sme-approved': 'SME_APPROVED',
  'sent-back': 'REVIEW_REWORK',
  'final-approval': 'REVIEW_APPROVED',
  approved: 'FINAL_APPROVED',
  rejected: 'FINAL_REJECTED',
  published: 'PUBLISHED',
  archived: 'ARCHIVED',
};

const ROLE_OF: Record<string, RoleName> = {
  HOG: RoleName.HOG,
  PC: RoleName.PROGRAMME_COMMITTEE,
  FACULTY: RoleName.FACULTY,
  SME: RoleName.SME,
  IC: RoleName.INSTRUCTION_CELL,
  INFO: RoleName.INSTRUCTION_CELL,
};

/** The person on the request in that role (for the greeting), else the viewer. */
function readerFor(
  f: RequestFacts | null,
  role: RoleName,
  viewer: { id: string; name: string; email: string },
): MailRecipient {
  const p = !f
    ? null
    : role === RoleName.HOG
      ? f.people.hog
      : role === RoleName.PROGRAMME_COMMITTEE
        ? f.people.pc
        : role === RoleName.FACULTY
          ? (f.people.faculty[0] ?? null)
          : role === RoleName.SME
            ? f.people.sme
            : f.people.ic;
  return {
    id: p?.id ?? viewer.id,
    name: p?.name ?? viewer.name,
    email: p?.email ?? viewer.email,
    role,
  };
}

export async function previewRequests(): Promise<{ id: string; label: string }[]> {
  const rows = await prisma.handoutRequest.findMany({
    orderBy: { updatedAt: 'desc' },
    take: 60,
    select: {
      id: true,
      refNo: true,
      status: true,
      offering: {
        select: { course: { select: { code: true } }, semester: { select: { name: true } } },
      },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    label: `${r.refNo} · ${r.offering.course.code} · ${r.offering.semester.name}`,
  }));
}

export async function previewEmail(
  key: string,
  requestId: string | null,
  viewer: { id: string; name: string; email: string; roles: string[] },
  wording?: Omit<WordingEdit, 'editedAt' | 'editedBy'> | null,
): Promise<EmailContent | null> {
  const entry = CATALOGUE_BY_KEY.get(key);
  if (!entry) return null;
  const ctx = await loadMailContext(viewer.name);
  if (wording) {
    const edits = new Map(ctx.edits ?? []);
    edits.set(key, { ...wording, editedAt: null, editedBy: null });
    ctx.edits = edits;
  }
  const [base, audience] = key.split(':') as [string, string | undefined];

  if (!entry.request) {
    const me = { name: viewer.name };
    switch (base) {
      case 'welcome':
      case 'welcome.password':
        return welcomeEmail(
          {
            name: viewer.name,
            email: viewer.email,
            roles: viewer.roles as RoleName[],
            department: null,
          },
          { addedBy: `${viewer.name} (example)`, sso: base === 'welcome' ? true : false },
          ctx,
        );
      case 'access.changed':
      case 'access.undone':
        return roleChangedEmail(
          me,
          {
            by: viewer.name,
            undo: base === 'access.undone',
            before: { roles: [RoleName.FACULTY], department: 'CSIS (example)' },
            after: {
              roles: [RoleName.FACULTY, RoleName.PROGRAMME_COMMITTEE],
              department: 'CSIS (example)',
            },
          },
          ctx,
        );
      case 'backup.named':
      case 'backup.removed':
        return backupEmail(
          me,
          {
            named: base === 'backup.named',
            person: 'Dr Example (example)',
            from: 'today',
            until: '20 Dec 2026',
          },
          ctx,
        );
      case 'taxila.run-finished':
        return taxilaRunEmail(
          me,
          {
            line: 'S1-26: 18 published, 2 need you (example)',
            url: ctx.url('/ic/taxila-runs'),
            problems: [
              { title: 'SS ZG653 (example)', reason: 'Other files in the Course Handout item' },
              { title: 'SE ZG501 (example)', reason: 'Course not found in Taxila' },
            ],
          },
          ctx,
        );
    }
    return null;
  }

  const id =
    requestId ??
    (
      await prisma.handoutRequest.findFirst({
        orderBy: { updatedAt: 'desc' },
        select: { id: true },
      })
    )?.id;
  if (!id) return null;
  const f = await loadRequestFacts(id);
  if (!f) return null;
  const event = EVENT_OF[base];
  if (event) {
    const role = ROLE_OF[audience ?? 'INFO'] ?? RoleName.INSTRUCTION_CELL;
    const to = readerFor(f, role, viewer);
    const x = await loadEventExtra(event, id);
    if (base === 'approved') x.autoPublish = audience === 'INFO';
    if (
      !x.decision &&
      (base === 'sent-back' || base === 'rejected' || base === 'allocation-sent-back')
    )
      x.decision = {
        by: f.people.pc?.name ?? 'The reviewer',
        stage: base === 'allocation-sent-back' ? 'PC_REVIEW' : 'PC_REVIEW',
        at: new Date(),
        comments: '(example) The comments the reviewer wrote appear here in full.',
      };
    const c = transitionChoice(event, role, f, x, ctx.actorName);
    return requestEmail(key, f, to, ctx, { tokens: c?.tokens, happened: c?.happened });
  }

  switch (base) {
    case 'reminder.due-soon':
    case 'reminder.overdue':
    case 'escalation': {
      const copy = base === 'escalation';
      const role = copy
        ? audience === 'IC'
          ? RoleName.INSTRUCTION_CELL
          : RoleName.HOG
        : RoleName.FACULTY;
      const holders = f.people.faculty.map((p) => p.name);
      return reminderEmail(
        f,
        readerFor(f, role, viewer),
        { copy, holders, told: copy ? holders : [] },
        ctx,
      );
    }
    case 'handover': {
      const isNew = audience === 'NEW';
      return handoverEmail(
        f,
        readerFor(f, RoleName.FACULTY, viewer),
        {
          isNew,
          role: 'faculty',
          from: f.people.faculty[0]?.name ?? 'Dr Previous (example)',
          toName: isNew ? (f.people.faculty[0]?.name ?? viewer.name) : 'Dr New (example)',
          reason: '(example) On leave for the semester',
        },
        ctx,
      );
    }
    case 'comment.mention':
    case 'comment.reply': {
      const c = await prisma.comment.findFirst({
        where: { handout: { requestId: id } },
        orderBy: { createdAt: 'desc' },
        select: { body: true, createdAt: true, author: { select: { name: true } } },
      });
      return commentEmail(
        f,
        readerFor(f, RoleName.FACULTY, viewer),
        {
          mention: base === 'comment.mention',
          author: c?.author.name ?? viewer.name,
          at: c?.createdAt ?? new Date(),
          text: c?.body ?? '(example) The comment appears here in full.',
          parent:
            base === 'comment.reply'
              ? { author: 'Dr Example', at: new Date(), text: '(example) The comment it answers.' }
              : null,
        },
        { ...ctx, actorName: c?.author.name ?? viewer.name },
      );
    }
    case 'auto-publish.stopped':
      return autoPublishStoppedEmail(
        f,
        readerFor(f, RoleName.INSTRUCTION_CELL, viewer),
        { reason: '(example) The Course Handout item already has another file.' },
        ctx,
      );
    default:
      return requestEmail(key, f, readerFor(f, RoleName.INSTRUCTION_CELL, viewer), ctx);
  }
}

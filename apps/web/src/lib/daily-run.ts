import {
  prisma,
  HandoutStatus,
  NotificationChannel,
  NotificationStatus,
  Prisma,
  RoleName,
} from '@hmp/db';
import { sendMail } from '@hmp/integrations';
import { loadMailContext } from './email/context';
import type { MailContext, MailRecipient } from './email/events';
import { renderEmail, type EmailContent } from './email/layout';
import { digestEmail, reminderEmail, weeklyEmail, type DigestItem } from './email/other';
import { loadRequestFacts } from './email/request-facts';
// Relative imports only: the worker (tsx) loads this file and doesn't know Next's '@/' alias.
import { LEVEL_TEXT, planRun, type PlannedStep } from './escalation';
import {
  DEADLINE_SELECT,
  STAGE_HOLDER,
  STAGE_LABEL,
  currentDeadline,
  daysLeft,
  deadlineInput,
  formatDueDay,
  istDay,
  loadDeadlineConfig,
} from './deadlines';
import {
  absoluteEmailLink,
  auditEmailFailure,
  deliver,
  deliverToUsers,
  instructionCellIds,
  linkFor,
} from './notifications';

/**
 * v1.4.2 — the daily 09:00 run (reminders, escalation, digests) and the Monday summary
 * (docs/plans/v1.4.2-workload.md §2, §7, §11). The worker's schedule queue calls `runScheduled`; each run is
 * recorded once per day / week (ScheduledRun), so a retried job, a restarted worker or the old reminders URL
 * called by a timer never sends twice. Admin → Notifications → Run now calls `runDailyNow`.
 */

export type ScheduledJob = 'daily' | 'weekly';

const isoDay = (d: Date) => new Date(d.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);

/** "2026-11-12" for daily; the Monday of the week for weekly (India time). */
export function periodKey(job: ScheduledJob, now: Date): string {
  if (job === 'daily') return isoDay(now);
  const day = istDay(now);
  const weekday = (day + 4) % 7; // 0 = Sunday (1 Jan 1970 was a Thursday)
  const monday = day - ((weekday + 6) % 7);
  return isoDay(new Date(monday * 86_400_000));
}

export interface RunSummary {
  skipped?: boolean;
  reminders?: number;
  notified?: number;
  digests?: number;
  summaries?: number;
  failed?: number;
}

/** Records the run for (job, period); null when it already ran — so it never runs twice. */
export async function claimRun(job: string, key: string): Promise<string | null> {
  try {
    return (await prisma.scheduledRun.create({ data: { job, periodKey: key } })).id;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null;
    throw err;
  }
}

/** Runs `job` for the current period unless it already ran. */
export async function runScheduled(job: ScheduledJob, now: Date = new Date()): Promise<RunSummary> {
  const runId = await claimRun(job, periodKey(job, now));
  if (!runId) return { skipped: true };
  const summary =
    job === 'daily' ? await daily(now) : { summaries: await sendWeeklySummaries(now) };
  await prisma.scheduledRun.update({
    where: { id: runId },
    data: { finishedAt: new Date(), summary: summary as Prisma.InputJsonValue },
  });
  return summary;
}

/** Admin → Notifications → Run now: the same work, recorded as a manual run. */
export async function runDailyNow(now: Date = new Date()): Promise<RunSummary> {
  const run = await prisma.scheduledRun.create({
    data: { job: 'daily-manual', periodKey: now.toISOString() },
  });
  const summary = await daily(now);
  await prisma.scheduledRun.update({
    where: { id: run.id },
    data: { finishedAt: new Date(), summary: summary as Prisma.InputJsonValue },
  });
  return summary;
}

async function daily(now: Date): Promise<RunSummary> {
  const r = await sendReminders(now);
  const d = await sendDigests();
  return { reminders: r.steps, notified: r.notified, digests: d.sent, failed: d.failed };
}

// ---- reminders and escalation ------------------------------------------------------------------

const HOLDER_ROLE: Record<PlannedStep['holderRole'], RoleName> = {
  HOG: RoleName.HOG,
  PC: RoleName.PROGRAMME_COMMITTEE,
  FACULTY: RoleName.FACULTY,
  SME: RoleName.SME,
  IC: RoleName.INSTRUCTION_CELL,
};

export function reminderText(
  step: PlannedStep,
  audience: 'holder' | 'copy',
): { subject: string; body: string } {
  const late = step.daysOverdue;
  const what = `${step.stageLabel} for ${step.course} (${step.refNo})`;
  if (step.level === 0)
    return {
      subject: `Due soon: ${step.course} — ${step.stageLabel}, due ${step.dueText}`,
      body: `${what} is due on ${step.dueText}.`,
    };
  if (audience === 'holder')
    return {
      subject: `Overdue: ${step.course} — ${step.stageLabel} (${late} day${late === 1 ? '' : 's'})`,
      body: `${what} was due on ${step.dueText} and is ${late} day${late === 1 ? '' : 's'} overdue. Please take action, or ask for a new due date.`,
    };
  return {
    subject: `Escalation: ${step.course} — ${step.stageLabel} ${late} days overdue`,
    body: `${what} was due on ${step.dueText} and is ${late} days overdue. It is with ${step.holder}. You are told because it is ${late} days late (${LEVEL_TEXT[step.level]}).`,
  };
}

export async function sendReminders(
  now: Date,
  opts: { only?: string[] } = {},
): Promise<{ steps: number; notified: number }> {
  const plan = await planRun(now, { only: opts.only });
  const ic = await instructionCellIds();
  const ctx = plan.length ? await loadMailContext('', now) : null;
  let notified = 0;
  for (const step of plan) {
    // v1.4.3: the full email (details, people, who has been told, what waits on it).
    const facts = ctx ? await loadRequestFacts(step.requestId) : null;
    const holders = step.holder ? [step.holder] : [];
    const mail =
      (copy: boolean) =>
      (to: MailRecipient): EmailContent | null =>
        facts && ctx ? reminderEmail(facts, to, { copy, holders, told: step.told }, ctx) : null;
    const meta = {
      stage: step.stage,
      level: step.level,
      dueAt: step.dueAt.toISOString(),
      daysOverdue: step.daysOverdue,
    };
    const urgent = step.level >= 1;
    const holderIds = step.holderRole === 'IC' ? ic : step.holderIds;
    const toHolder = reminderText(step, 'holder');
    notified += await deliverToUsers(holderIds, HOLDER_ROLE[step.holderRole], {
      requestId: step.requestId,
      ...toHolder,
      metaKind: 'deadline.reminder',
      extraMeta: meta,
      urgent,
      mail: mail(false),
      dueAt: step.dueAt,
    });
    const copy = reminderText(step, 'copy');
    if (step.hogIds.length)
      notified += await deliverToUsers(step.hogIds, RoleName.HOG, {
        requestId: step.requestId,
        ...copy,
        metaKind: 'deadline.escalation',
        extraMeta: meta,
        urgent: true,
        mail: mail(true),
      });
    if (step.toIc && step.holderRole !== 'IC')
      notified += await deliverToUsers(ic, RoleName.INSTRUCTION_CELL, {
        requestId: step.requestId,
        ...copy,
        metaKind: 'deadline.escalation',
        extraMeta: meta,
        urgent: true,
        mail: mail(true),
      });
    // This level and the ones below count as sent for this stage and due date.
    await prisma.escalationStep.createMany({
      data: Array.from({ length: step.level + 1 }, (_, level) => ({
        requestId: step.requestId,
        stage: step.stage,
        dueAt: step.dueAt,
        level,
      })),
      skipDuplicates: true,
    });
  }
  return { steps: plan.length, notified };
}

// ---- daily digest (F6) ---------------------------------------------------------------------------

/** Notices that hand the work to the reader (the rest are "for information"). */
const ACTION_EVENTS = new Set([
  'REQUEST_INITIATED',
  'FACULTY_ALLOCATED',
  'ASSIGNED',
  'SME_REVIEW_REQUESTED',
  'SME_APPROVED',
  'REVIEW_APPROVED',
  'FINAL_APPROVED',
]);

export async function sendDigests(): Promise<{ sent: number; failed: number }> {
  const rows = await prisma.notification.findMany({
    where: {
      channel: NotificationChannel.EMAIL,
      status: NotificationStatus.PENDING,
      meta: { path: ['digest'], equals: true },
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      subject: true,
      body: true,
      link: true,
      meta: true,
      createdAt: true,
      user: { select: { id: true, email: true, name: true, active: true } },
    },
  });
  let ctx: MailContext | null = null;
  const byUser = new Map<string, typeof rows>();
  for (const r of rows) byUser.set(r.user.id, [...(byUser.get(r.user.id) ?? []), r]);
  let sent = 0;
  let failed = 0;
  for (const items of byUser.values()) {
    const u = items[0]!.user;
    const ids = items.map((i) => i.id);
    if (!u.active) {
      await prisma.notification.updateMany({
        where: { id: { in: ids } },
        data: { status: NotificationStatus.FAILED },
      });
      continue;
    }
    // v1.4.3: each held notice kept its compact block (digestItem); older ones fall back to their line.
    const isAction = (i: (typeof items)[number]) =>
      ACTION_EVENTS.has(String((i.meta as { event?: string } | null)?.event ?? ''));
    const blocks: DigestItem[] = items.map(
      (i) =>
        (i.meta as { digestItem?: DigestItem } | null)?.digestItem ?? {
          action: isAction(i),
          title: i.subject,
          url: absoluteEmailLink(i.link ?? '/'),
          lines: [i.body],
        },
    );
    ctx ??= await loadMailContext();
    const { subject, html, text } = renderEmail(digestEmail({ name: u.name }, blocks, ctx));
    const result = await sendMail({
      to: u.email,
      subject,
      html,
      text,
      replyTo: ctx.footer.replyTo,
    }).catch((e: unknown) => ({
      ok: false as const,
      error: String(e),
    }));
    await prisma.notification.updateMany({
      where: { id: { in: ids } },
      data: result.ok
        ? { status: NotificationStatus.SENT, sentAt: new Date() }
        : { status: NotificationStatus.FAILED },
    });
    if (!result.ok) await auditEmailFailure(ids[0]!, { to: u.email, subject }, result.error);
    if (result.ok) sent += 1;
    else failed += 1;
  }
  return { sent, failed };
}

// ---- weekly summary (F7) -------------------------------------------------------------------------

interface DeptSummary {
  id: string;
  name: string;
  inProgress: number;
  overdue: { refNo: string; course: string; step: string; days: number; requestId: string }[];
  approved: number;
  publishedThisWeek: number;
}

const HOLDER_WORD: Record<(typeof STAGE_HOLDER)[keyof typeof STAGE_HOLDER], string> = {
  HOG: 'with the HOG',
  PC: 'with the PC',
  FACULTY: 'with the faculty',
  SME: 'with the SME',
  IC: 'with the Instruction Cell',
};

const OPEN: HandoutStatus[] = [
  HandoutStatus.REQUESTED,
  HandoutStatus.ALLOCATED,
  HandoutStatus.ASSIGNED,
  HandoutStatus.IN_PROGRESS,
  HandoutStatus.REWORK_REQUESTED,
  HandoutStatus.SME_REVIEW,
  HandoutStatus.SUBMITTED,
  HandoutStatus.UNDER_REVIEW,
];

export async function weeklyNumbers(now: Date): Promise<DeptSummary[]> {
  const cfg = await loadDeadlineConfig();
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const [departments, rows] = await Promise.all([
    prisma.department.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.handoutRequest.findMany({
      where: {
        OR: [
          { status: { in: [...OPEN, HandoutStatus.APPROVED] } },
          { status: HandoutStatus.PUBLISHED, statusChangedAt: { gte: weekAgo } },
        ],
      },
      select: {
        ...DEADLINE_SELECT,
        refNo: true,
        offering: {
          select: {
            course: { select: { code: true, title: true } },
            semester: {
              select: { startDate: true, programme: { select: { departmentId: true } } },
            },
          },
        },
      },
    }),
  ]);
  const out = new Map<string, DeptSummary>(
    [...departments, { id: 'none', name: 'Department not known' }].map((d) => [
      d.id,
      { ...d, inProgress: 0, overdue: [], approved: 0, publishedThisWeek: 0 },
    ]),
  );
  for (const r of rows) {
    const d = out.get(r.offering.semester.programme.departmentId ?? 'none');
    if (!d) continue;
    if (r.status === HandoutStatus.PUBLISHED) d.publishedThisWeek += 1;
    else if (r.status === HandoutStatus.APPROVED) d.approved += 1;
    else d.inProgress += 1;
    const due = currentDeadline(deadlineInput(r), cfg);
    if (due && r.status !== HandoutStatus.PUBLISHED && daysLeft(due.dueAt, now) < 0)
      d.overdue.push({
        refNo: r.refNo,
        requestId: r.id,
        course: `${r.offering.course.code} ${r.offering.course.title}`,
        step: `${STAGE_LABEL[due.stage]} (${HOLDER_WORD[STAGE_HOLDER[due.stage]]}, due ${formatDueDay(due.dueAt)})`,
        days: -daysLeft(due.dueAt, now),
      });
  }
  for (const d of out.values()) d.overdue.sort((a, b) => b.days - a.days);
  return [...out.values()].filter(
    (d) => d.id !== 'none' || d.inProgress + d.approved + d.publishedThisWeek > 0,
  );
}

/** v1.4.3: the Monday summary in the shared layout (lib/email/other.ts weeklyEmail). */
export function summaryEmail(
  name: string,
  depts: DeptSummary[],
  role: RoleName,
  week: string,
  ctx: MailContext,
) {
  const content = weeklyEmail(
    { name },
    {
      week,
      dashboardUrl: ctx.url(
        role === RoleName.INSTRUCTION_CELL ? '/ic/dashboard' : '/hog/department',
      ),
      depts: depts.map((d) => ({
        name: d.name,
        inProgress: d.inProgress,
        approved: d.approved,
        publishedThisWeek: d.publishedThisWeek,
        overdue: d.overdue.map((o) => ({
          ...o,
          url: absoluteEmailLink(linkFor(role, o.requestId)),
        })),
      })),
    },
    ctx,
  );
  return { content, ...renderEmail(content) };
}

/** Monday: each HOG their department, each IC every department (H20: on unless switched off). */
export async function sendWeeklySummaries(now: Date): Promise<number> {
  const depts = await weeklyNumbers(now);
  const people = await prisma.user.findMany({
    where: {
      active: true,
      roles: { some: { role: { name: { in: [RoleName.HOG, RoleName.INSTRUCTION_CELL] } } } },
      NOT: { preference: { weeklySummary: false } },
    },
    select: {
      id: true,
      name: true,
      email: true,
      departmentId: true,
      roles: { select: { role: { select: { name: true } } } },
    },
  });
  const week = formatDueDay(new Date(`${periodKey('weekly', now)}T00:00:00+05:30`));
  const ctx = await loadMailContext('', now);
  let n = 0;
  for (const p of people) {
    const isIc = p.roles.some((r) => r.role.name === RoleName.INSTRUCTION_CELL);
    const mine = isIc ? depts : depts.filter((d) => d.id === p.departmentId);
    if (mine.length === 0) continue;
    const role = isIc ? RoleName.INSTRUCTION_CELL : RoleName.HOG;
    const mail = summaryEmail(p.name, mine, role, week, ctx);
    await deliver({
      userId: p.id,
      email: p.email,
      role,
      subject: mail.subject,
      body: mail.content.summary,
      link: isIc ? '/ic/dashboard' : '/hog/department',
      channels: [NotificationChannel.EMAIL],
      metaKind: 'summary.weekly',
      urgent: true,
      mail: mail.content,
    });
    n += 1;
  }
  return n;
}

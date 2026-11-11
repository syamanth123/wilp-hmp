import type { HandoutStatus} from '@hmp/db';
import { prisma, DeadlineStage, type WorkflowConfig } from '@hmp/db';

/**
 * v1.4.2 — due dates per stage (docs/plans/v1.4.2-workload.md §1).
 *
 *   planned date  = the semester's start − the stage's offset (Admin → Workflow, days)
 *   current stage = the later of the planned date and "the day the stage began + its SLA", so a request
 *                   that starts late (or is sent back) still gets fair time
 *   later stages  = the later of the planned date and "the previous stage's due date + its SLA"
 *   a date someone changed by hand (RequestDeadline) always wins
 *
 * Nothing but hand-changed dates is stored: the rule runs whenever a date is shown, so existing requests
 * have dates from the release and changing an offset moves every date nobody changed.
 * A due date is a calendar day (India time): due "on 12 Dec" means by the end of 12 Dec.
 */

export const STAGES: DeadlineStage[] = [
  DeadlineStage.ALLOCATION,
  DeadlineStage.DRAFT,
  DeadlineStage.SME_REVIEW,
  DeadlineStage.PC_REVIEW,
  DeadlineStage.HOG_FINAL,
  DeadlineStage.PUBLISH,
];

export const STAGE_LABEL: Record<DeadlineStage, string> = {
  ALLOCATION: 'Allocation',
  DRAFT: 'Faculty draft',
  SME_REVIEW: 'SME review',
  PC_REVIEW: 'PC review',
  HOG_FINAL: 'HOG final approval',
  PUBLISH: 'Publish',
};

/** Who acts in each stage (for "My work" and escalation). */
export const STAGE_HOLDER: Record<DeadlineStage, 'HOG' | 'PC' | 'FACULTY' | 'SME' | 'IC'> = {
  ALLOCATION: 'HOG',
  DRAFT: 'FACULTY',
  SME_REVIEW: 'SME',
  PC_REVIEW: 'PC',
  HOG_FINAL: 'HOG',
  PUBLISH: 'IC',
};

const STAGE_OF_STATUS: Partial<Record<HandoutStatus, DeadlineStage>> = {
  REQUESTED: DeadlineStage.ALLOCATION,
  ALLOCATED: DeadlineStage.ALLOCATION,
  ASSIGNED: DeadlineStage.DRAFT,
  IN_PROGRESS: DeadlineStage.DRAFT,
  REWORK_REQUESTED: DeadlineStage.DRAFT,
  SME_REVIEW: DeadlineStage.SME_REVIEW,
  SUBMITTED: DeadlineStage.PC_REVIEW,
  UNDER_REVIEW: DeadlineStage.HOG_FINAL,
  APPROVED: DeadlineStage.PUBLISH,
};

export function stageForStatus(status: HandoutStatus): DeadlineStage | null {
  return STAGE_OF_STATUS[status] ?? null;
}

/** Hours "Approved → published" gets when the semester start is too close (no Admin setting yet). */
export const PUBLISH_SLA_HOURS = 72;

export type DeadlineConfig = Pick<
  WorkflowConfig,
  | 'hogReviewSla'
  | 'pcReviewSla'
  | 'facultySubmitSla'
  | 'hogFinalSla'
  | 'smeReviewSla'
  | 'dueAllocationDays'
  | 'dueDraftDays'
  | 'dueSmeDays'
  | 'duePcDays'
  | 'dueHogFinalDays'
  | 'duePublishDays'
>;

export function offsetDays(cfg: DeadlineConfig, stage: DeadlineStage): number {
  switch (stage) {
    case 'ALLOCATION':
      return cfg.dueAllocationDays;
    case 'DRAFT':
      return cfg.dueDraftDays;
    case 'SME_REVIEW':
      return cfg.dueSmeDays;
    case 'PC_REVIEW':
      return cfg.duePcDays;
    case 'HOG_FINAL':
      return cfg.dueHogFinalDays;
    case 'PUBLISH':
      return cfg.duePublishDays;
  }
}

export function stageSlaHours(cfg: DeadlineConfig, stage: DeadlineStage): number {
  switch (stage) {
    case 'ALLOCATION':
      return cfg.hogReviewSla;
    case 'DRAFT':
      return cfg.facultySubmitSla;
    case 'SME_REVIEW':
      return cfg.smeReviewSla;
    case 'PC_REVIEW':
      return cfg.pcReviewSla;
    case 'HOG_FINAL':
      return cfg.hogFinalSla;
    case 'PUBLISH':
      return PUBLISH_SLA_HOURS;
  }
}

// ---- India-time calendar days -------------------------------------------------------------------

const DAY_MS = 86_400_000;
const IST_OFFSET_MS = 5.5 * 3_600_000;

/** Whole days since 1970 in India time. */
export function istDay(d: Date): number {
  return Math.floor((d.getTime() + IST_OFFSET_MS) / DAY_MS);
}

/** Midnight (India time) of the given India-time day, as a Date. */
export function istDayStart(day: number): Date {
  return new Date(day * DAY_MS - IST_OFFSET_MS);
}

/** The India-time day of `d`, normalised to its midnight. */
export function asDueDay(d: Date): Date {
  return istDayStart(istDay(d));
}

// ---- the rule -----------------------------------------------------------------------------------

export interface DeadlineInput {
  status: HandoutStatus;
  /** When the current status began (statusChangedAt, else updatedAt for safety). */
  stageStartedAt: Date;
  semesterStart: Date | null;
  manual: Partial<Record<DeadlineStage, { dueAt: Date; reason: string; setByName: string | null }>>;
}

export interface StageDeadline {
  stage: DeadlineStage;
  label: string;
  dueAt: Date;
  source: 'rule' | 'manual';
  reason?: string;
  setByName?: string | null;
  state: 'done' | 'current' | 'later';
}

const maxDate = (a: Date, b: Date) => (a.getTime() >= b.getTime() ? a : b);

export function deadlinesFor(input: DeadlineInput, cfg: DeadlineConfig): StageDeadline[] {
  const current = stageForStatus(input.status);
  const currentIdx = current
    ? STAGES.indexOf(current)
    : input.status === 'PUBLISHED' || input.status === 'ARCHIVED'
      ? STAGES.length
      : -1;
  const out: StageDeadline[] = [];
  let prevDue: Date | null = null;
  STAGES.forEach((stage, idx) => {
    const planned = input.semesterStart
      ? asDueDay(new Date(input.semesterStart.getTime() - offsetDays(cfg, stage) * DAY_MS))
      : null;
    const sla = stageSlaHours(cfg, stage) * 3_600_000;
    let due: Date;
    if (idx === currentIdx) {
      const fair = asDueDay(new Date(input.stageStartedAt.getTime() + sla));
      due = planned ? maxDate(planned, fair) : fair;
    } else {
      const chained = prevDue ? asDueDay(new Date(prevDue.getTime() + sla)) : null;
      due =
        planned && chained
          ? maxDate(planned, chained)
          : (planned ?? chained ?? asDueDay(new Date(input.stageStartedAt.getTime() + sla)));
    }
    const m = input.manual[stage];
    const entry: StageDeadline = {
      stage,
      label: STAGE_LABEL[stage],
      dueAt: m ? asDueDay(m.dueAt) : due,
      source: m ? 'manual' : 'rule',
      state:
        currentIdx < 0
          ? 'later'
          : idx < currentIdx
            ? 'done'
            : idx === currentIdx
              ? 'current'
              : 'later',
      ...(m ? { reason: m.reason, setByName: m.setByName } : {}),
    };
    out.push(entry);
    prevDue = entry.dueAt;
  });
  return out;
}

export function currentDeadline(input: DeadlineInput, cfg: DeadlineConfig): StageDeadline | null {
  return deadlinesFor(input, cfg).find((d) => d.state === 'current') ?? null;
}

/** Days left until the due day (0 = due today, negative = days overdue). */
export function daysLeft(dueAt: Date, now: Date = new Date()): number {
  return istDay(dueAt) - istDay(now);
}

export function dueWords(
  dueAt: Date,
  now: Date = new Date(),
): { text: string; tone: 'overdue' | 'soon' | 'ok' } {
  const n = daysLeft(dueAt, now);
  if (n < 0) return { text: `${-n} day${n === -1 ? '' : 's'} overdue`, tone: 'overdue' };
  if (n === 0) return { text: 'due today', tone: 'soon' };
  if (n <= 2) return { text: `${n} day${n === 1 ? '' : 's'} left`, tone: 'soon' };
  return { text: `${n} days left`, tone: 'ok' };
}

export function formatDueDay(d: Date): string {
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

// ---- loading ------------------------------------------------------------------------------------

export async function loadDeadlineConfig(): Promise<DeadlineConfig> {
  const cfg = await prisma.workflowConfig.findUnique({ where: { key: 'default' } });
  return (
    cfg ?? {
      hogReviewSla: 72,
      pcReviewSla: 72,
      facultySubmitSla: 168,
      hogFinalSla: 48,
      smeReviewSla: 72,
      dueAllocationDays: 35,
      dueDraftDays: 21,
      dueSmeDays: 17,
      duePcDays: 14,
      dueHogFinalDays: 10,
      duePublishDays: 7,
    }
  );
}

export interface DeadlineRow {
  id: string;
  status: HandoutStatus;
  statusChangedAt: Date | null;
  updatedAt: Date;
  offering: { semester: { startDate: Date } };
  deadlines: {
    stage: DeadlineStage;
    dueAt: Date;
    reason: string;
    setBy: { name: string } | null;
  }[];
}

/** The select clause that gives a DeadlineRow. */
export const DEADLINE_SELECT = {
  id: true,
  status: true,
  statusChangedAt: true,
  updatedAt: true,
  offering: { select: { semester: { select: { startDate: true } } } },
  deadlines: {
    select: { stage: true, dueAt: true, reason: true, setBy: { select: { name: true } } },
  },
} as const;

export function deadlineInput(r: DeadlineRow): DeadlineInput {
  const manual: DeadlineInput['manual'] = {};
  for (const d of r.deadlines)
    manual[d.stage] = { dueAt: d.dueAt, reason: d.reason, setByName: d.setBy?.name ?? null };
  return {
    status: r.status,
    stageStartedAt: r.statusChangedAt ?? r.updatedAt,
    semesterStart: r.offering.semester.startDate,
    manual,
  };
}

import { prisma, HandoutStatus, type Prisma, type WorkflowConfig } from '@hmp/db';
import {
  DEADLINE_SELECT,
  currentDeadline,
  daysLeft,
  deadlineInput,
  loadDeadlineConfig,
} from './deadlines';

export type SlaClassification = 'on_track' | 'due_soon' | 'overdue' | 'n_a';

export interface SlaInfo {
  classification: SlaClassification;
  slaHours: number | null;
  ageHours: number;
  enteredAt: Date;
}

const STATUS_HOLDER: Partial<Record<HandoutStatus, 'HOG' | 'PC' | 'FACULTY' | 'IC'>> = {
  [HandoutStatus.REQUESTED]: 'HOG',
  [HandoutStatus.ALLOCATED]: 'PC',
  [HandoutStatus.ASSIGNED]: 'FACULTY',
  [HandoutStatus.IN_PROGRESS]: 'FACULTY',
  [HandoutStatus.REWORK_REQUESTED]: 'FACULTY',
  [HandoutStatus.SUBMITTED]: 'PC',
  [HandoutStatus.UNDER_REVIEW]: 'HOG',
  [HandoutStatus.APPROVED]: 'IC',
};

export function holderForStatus(status: HandoutStatus): 'HOG' | 'PC' | 'FACULTY' | 'IC' | null {
  return STATUS_HOLDER[status] ?? null;
}

export function slaHoursFor(cfg: WorkflowConfig, status: HandoutStatus): number | null {
  switch (status) {
    case HandoutStatus.REQUESTED:
    case HandoutStatus.ALLOCATED:
      return cfg.hogReviewSla;
    case HandoutStatus.ASSIGNED:
    case HandoutStatus.IN_PROGRESS:
    case HandoutStatus.REWORK_REQUESTED:
      return cfg.facultySubmitSla;
    case HandoutStatus.SUBMITTED:
      return cfg.pcReviewSla;
    case HandoutStatus.UNDER_REVIEW:
      return cfg.hogFinalSla;
    default:
      return null;
  }
}

export function classify(
  status: HandoutStatus,
  enteredAt: Date,
  cfg: WorkflowConfig,
  now: Date = new Date(),
): SlaInfo {
  const slaHours = slaHoursFor(cfg, status);
  const ageHours = (now.getTime() - enteredAt.getTime()) / 3_600_000;
  if (slaHours == null) {
    return { classification: 'n_a', slaHours: null, ageHours, enteredAt };
  }
  let classification: SlaClassification = 'on_track';
  if (ageHours >= slaHours) classification = 'overdue';
  else if (ageHours >= slaHours * 0.75) classification = 'due_soon';
  return { classification, slaHours, ageHours, enteredAt };
}

const NON_TERMINAL: HandoutStatus[] = [
  HandoutStatus.REQUESTED,
  HandoutStatus.ALLOCATED,
  HandoutStatus.ASSIGNED,
  HandoutStatus.IN_PROGRESS,
  HandoutStatus.REWORK_REQUESTED,
  HandoutStatus.SME_REVIEW,
  HandoutStatus.SUBMITTED,
  HandoutStatus.UNDER_REVIEW,
  HandoutStatus.APPROVED,
];

export async function loadWorkflowConfig(): Promise<WorkflowConfig> {
  const cfg = await prisma.workflowConfig.findUnique({ where: { key: 'default' } });
  if (!cfg) {
    // Fallback in case seed didn't run — match schema defaults.
    return {
      id: 'fallback',
      key: 'default',
      hogReviewSla: 72,
      pcReviewSla: 72,
      facultySubmitSla: 168,
      hogFinalSla: 48,
      offCampusMaxCourses: 3,
      smeReviewSla: 72,
      dueAllocationDays: 35,
      dueDraftDays: 21,
      dueSmeDays: 17,
      duePcDays: 14,
      dueHogFinalDays: 10,
      duePublishDays: 7,
      escalationOn: false,
      escalationDays: 3,
      autoPublish: false,
      matrixJson: {} as never,
      updatedAt: new Date(),
    } as WorkflowConfig;
  }
  return cfg;
}

/**
 * `scope` narrows the scan to one person's requests (e.g. the faculty dashboard counts only that faculty
 * member's own assignments). v1.4.2: due soon / overdue come from the request's due dates
 * (lib/deadlines.ts) — due within 2 days, or past the due day — not from updatedAt + SLA hours.
 */
export async function scanActiveRequestsWithSla(
  filterStatuses?: HandoutStatus[],
  scope?: Prisma.HandoutRequestWhereInput,
  now: Date = new Date(),
) {
  const cfg = await loadDeadlineConfig();
  const statuses = filterStatuses && filterStatuses.length > 0 ? filterStatuses : NON_TERMINAL;
  const rows = await prisma.handoutRequest.findMany({
    where: scope ? { AND: [{ status: { in: statuses } }, scope] } : { status: { in: statuses } },
    select: {
      ...DEADLINE_SELECT,
      refNo: true,
      offering: {
        select: {
          course: { select: { code: true, title: true } },
          semester: {
            select: { name: true, startDate: true, programme: { select: { code: true } } },
          },
        },
      },
    },
  });
  return rows.map((r) => {
    const due = currentDeadline(deadlineInput(r), cfg);
    const left = due ? daysLeft(due.dueAt, now) : null;
    const classification: SlaClassification =
      left == null ? 'n_a' : left < 0 ? 'overdue' : left <= 2 ? 'due_soon' : 'on_track';
    return { ...r, dueAt: due?.dueAt ?? null, sla: { classification } };
  });
}

export async function countSlaBucketsForStatuses(
  statuses: HandoutStatus[],
  scope?: Prisma.HandoutRequestWhereInput,
) {
  const scanned = await scanActiveRequestsWithSla(statuses, scope);
  return {
    total: scanned.length,
    dueSoon: scanned.filter((r) => r.sla.classification === 'due_soon').length,
    overdue: scanned.filter((r) => r.sla.classification === 'overdue').length,
  };
}

import { prisma, HandoutStatus, RoleName, type DeadlineStage } from '@hmp/db';
import {
  DEADLINE_SELECT,
  STAGE_LABEL,
  currentDeadline,
  daysLeft,
  deadlineInput,
  formatDueDay,
  istDay,
  istDayStart,
  loadDeadlineConfig,
} from './deadlines';

/**
 * v1.4.2 — daily reminders and escalation (docs/plans/v1.4.2-workload.md §2, H17, H26).
 *
 *   level 0  due within 2 days            → the person holding it ("due soon")
 *   level 1  past the due date            → the person holding it ("overdue")
 *   level 2  overdue by N days (default 3) → + the request's HOG (a HOG's own stage → + IC)
 *   level 3  overdue by 2N days           → + the Instruction Cell
 *
 * Levels 2 and 3 only while escalation is on (Admin → Workflow). Each level is sent once per stage and due
 * date (EscalationStep); a request first seen at a high level gets only that level (lower ones count as
 * sent), so nobody gets three emails about one request on one morning.
 */

export type Level = 0 | 1 | 2 | 3;

export const LEVEL_TEXT: Record<Level, string> = {
  0: 'Due soon',
  1: 'Overdue',
  2: 'Overdue — copy to the HOG',
  3: 'Overdue — copy to the Instruction Cell',
};

/** Which level a request has reached on `day`, or null. Pure. */
export function levelReached(
  input: { left: number; holderIsHog: boolean },
  cfg: { escalationOn: boolean; escalationDays: number },
): Level | null {
  const { left } = input;
  if (left > 2) return null;
  if (left >= 0) return 0;
  const late = -left;
  if (!cfg.escalationOn) return 1;
  const n = Math.max(1, cfg.escalationDays);
  if (late >= 2 * n && !input.holderIsHog) return 3;
  if (late >= n) return 2;
  return 1;
}

interface Person {
  id: string;
  name: string;
}

export interface PlannedStep {
  requestId: string;
  refNo: string;
  course: string;
  stage: DeadlineStage;
  stageLabel: string;
  dueAt: Date;
  dueText: string;
  daysOverdue: number;
  level: Level;
  holder: string;
  /** Who is told at this level (names, or "Instruction Cell"). */
  told: string[];
  /** For sending: the people holding it (and their role), the HOG copy, the IC copy. */
  holderRole: 'HOG' | 'PC' | 'FACULTY' | 'SME' | 'IC';
  holderIds: string[];
  hogIds: string[];
  toIc: boolean;
}

const OPEN: HandoutStatus[] = [
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

/** The run of India-time day `day` happens at 09:00 that day. */
export const runTimeOf = (day: number) => new Date(istDayStart(day).getTime() + 9 * 3_600_000);

const PERSON = { select: { id: true, name: true } } as const;

/**
 * What the daily run on `runAt` would send — nothing is sent or recorded. Used by Admin → Workflow
 * ("What tomorrow's run would send") and, in the run itself (lib/daily-run.ts), as the list to send.
 */
export async function planRun(
  runAt: Date,
  override?: { escalationOn?: boolean; escalationDays?: number; only?: string[] },
): Promise<PlannedStep[]> {
  const base = await loadDeadlineConfig();
  const wf = await prisma.workflowConfig.findUnique({ where: { key: 'default' } });
  const cfg = {
    escalationOn: override?.escalationOn ?? wf?.escalationOn ?? false,
    escalationDays: override?.escalationDays ?? wf?.escalationDays ?? 3,
  };
  const [rows, everyone] = await Promise.all([
    prisma.handoutRequest.findMany({
      where: { status: { in: OPEN }, ...(override?.only ? { id: { in: override.only } } : {}) },
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
        assignees: { where: { endedAt: null }, select: { role: true, user: PERSON } },
        assignments: { where: { active: true }, select: { faculty: PERSON } },
        smeAssignment: { select: { smeUser: PERSON } },
        escalationSteps: { select: { stage: true, dueAt: true, level: true } },
      },
    }),
    // HOGs and PCs (with their department), for requests with nobody named yet.
    prisma.user.findMany({
      where: {
        active: true,
        roles: { some: { role: { name: { in: [RoleName.HOG, RoleName.PROGRAMME_COMMITTEE] } } } },
      },
      select: {
        id: true,
        name: true,
        departmentId: true,
        roles: { select: { role: { select: { name: true } } } },
      },
    }),
  ]);
  const inRole = (role: RoleName, deptId: string | null): Person[] => {
    const all = everyone.filter((u) => u.roles.some((x) => x.role.name === role));
    const dept = deptId ? all.filter((u) => u.departmentId === deptId) : [];
    return (dept.length ? dept : all).map((u) => ({ id: u.id, name: u.name }));
  };

  const out: PlannedStep[] = [];
  for (const r of rows) {
    const due = currentDeadline(deadlineInput(r), base);
    if (!due) continue;
    const left = daysLeft(due.dueAt, runAt);
    const deptId = r.offering.semester.programme.departmentId;
    const named = (role: RoleName) => r.assignees.filter((a) => a.role === role).map((a) => a.user);
    const hog = named(RoleName.HOG).length ? named(RoleName.HOG) : inRole(RoleName.HOG, deptId);
    const pc = named(RoleName.PROGRAMME_COMMITTEE).length
      ? named(RoleName.PROGRAMME_COMMITTEE)
      : inRole(RoleName.PROGRAMME_COMMITTEE, deptId);
    const s = r.status;
    const holderRole: PlannedStep['holderRole'] =
      s === HandoutStatus.REQUESTED || s === HandoutStatus.UNDER_REVIEW
        ? 'HOG'
        : s === HandoutStatus.ALLOCATED || s === HandoutStatus.SUBMITTED
          ? 'PC'
          : s === HandoutStatus.SME_REVIEW
            ? 'SME'
            : s === HandoutStatus.APPROVED
              ? 'IC'
              : 'FACULTY';
    const holders: Person[] =
      holderRole === 'HOG'
        ? hog
        : holderRole === 'PC'
          ? pc
          : holderRole === 'SME'
            ? r.smeAssignment
              ? [r.smeAssignment.smeUser]
              : []
            : holderRole === 'FACULTY'
              ? r.assignments.map((a) => a.faculty)
              : [];
    const holderIsHog = holderRole === 'HOG';
    const level = levelReached({ left, holderIsHog }, cfg);
    if (level == null) continue;
    const sent = r.escalationSteps.some(
      (x) => x.stage === due.stage && x.dueAt.getTime() === due.dueAt.getTime() && x.level >= level,
    );
    if (sent) continue;
    const holderText = holderRole === 'IC' ? ['Instruction Cell'] : holders.map((h) => h.name);
    const hogCopy = level >= 2 && !holderIsHog ? hog : [];
    const toIc = level === 3 || (level >= 2 && holderIsHog) || holderRole === 'IC';
    const told = [
      ...holderText,
      ...hogCopy.map((h) => h.name),
      ...(toIc ? ['Instruction Cell'] : []),
    ];
    out.push({
      requestId: r.id,
      refNo: r.refNo,
      course: `${r.offering.course.code} ${r.offering.course.title}`,
      stage: due.stage,
      stageLabel: STAGE_LABEL[due.stage],
      dueAt: due.dueAt,
      dueText: formatDueDay(due.dueAt),
      daysOverdue: Math.max(0, -left),
      level,
      holder: holderText.join(', '),
      told: [...new Set(told)],
      holderRole,
      holderIds: holders.map((h) => h.id),
      hogIds: hogCopy.map((h) => h.id),
      toIc,
    });
  }
  return out.sort((a, b) => b.level - a.level || b.daysOverdue - a.daysOverdue);
}

/** Tomorrow's 09:00 run (India time), as seen from `now`. */
export function tomorrowsRun(now: Date = new Date()): Date {
  return runTimeOf(istDay(now) + 1);
}

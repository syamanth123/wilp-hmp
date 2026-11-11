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

/**
 * What the daily run on `runAt` would send — nothing is sent or recorded. Used by Admin → Workflow
 * ("What tomorrow's run would send") and, in the run itself, as the list to send.
 */
export async function planRun(
  runAt: Date,
  override?: { escalationOn?: boolean; escalationDays?: number },
): Promise<PlannedStep[]> {
  const base = await loadDeadlineConfig();
  const wf = await prisma.workflowConfig.findUnique({ where: { key: 'default' } });
  const cfg = {
    escalationOn: override?.escalationOn ?? wf?.escalationOn ?? false,
    escalationDays: override?.escalationDays ?? wf?.escalationDays ?? 3,
  };
  const rows = await prisma.handoutRequest.findMany({
    where: { status: { in: OPEN } },
    select: {
      ...DEADLINE_SELECT,
      refNo: true,
      offering: {
        select: {
          course: { select: { code: true, title: true } },
          semester: {
            select: {
              startDate: true,
              programme: {
                select: {
                  department: {
                    select: {
                      name: true,
                      users: {
                        where: {
                          active: true,
                          roles: {
                            some: {
                              role: { name: { in: [RoleName.HOG, RoleName.PROGRAMME_COMMITTEE] } },
                            },
                          },
                        },
                        select: {
                          name: true,
                          roles: { select: { role: { select: { name: true } } } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      assignees: {
        where: { endedAt: null },
        select: { role: true, user: { select: { name: true } } },
      },
      assignments: { where: { active: true }, select: { faculty: { select: { name: true } } } },
      smeAssignment: { select: { smeUser: { select: { name: true } } } },
      escalationSteps: { select: { stage: true, dueAt: true, level: true } },
    },
  });

  const out: PlannedStep[] = [];
  for (const r of rows) {
    const due = currentDeadline(deadlineInput(r), base);
    if (!due) continue;
    const left = daysLeft(due.dueAt, runAt);
    const dept = r.offering.semester.programme.department;
    const deptPeople = (role: RoleName) =>
      (dept?.users ?? [])
        .filter((u) => u.roles.some((x) => x.role.name === role))
        .map((u) => u.name);
    const named = (role: RoleName) =>
      r.assignees.filter((a) => a.role === role).map((a) => a.user.name);
    const hog = named(RoleName.HOG).length ? named(RoleName.HOG) : deptPeople(RoleName.HOG);
    const pc = named(RoleName.PROGRAMME_COMMITTEE).length
      ? named(RoleName.PROGRAMME_COMMITTEE)
      : deptPeople(RoleName.PROGRAMME_COMMITTEE);
    const holderIsHog =
      r.status === HandoutStatus.REQUESTED || r.status === HandoutStatus.UNDER_REVIEW;
    const holder: string[] =
      r.status === HandoutStatus.REQUESTED || r.status === HandoutStatus.UNDER_REVIEW
        ? hog.length
          ? hog
          : ['all HOGs']
        : r.status === HandoutStatus.ALLOCATED || r.status === HandoutStatus.SUBMITTED
          ? pc.length
            ? pc
            : ['all PCs']
          : r.status === HandoutStatus.SME_REVIEW
            ? [r.smeAssignment?.smeUser.name ?? 'the SME']
            : r.status === HandoutStatus.APPROVED
              ? ['Instruction Cell']
              : r.assignments.map((a) => a.faculty.name);
    const level = levelReached({ left, holderIsHog }, cfg);
    if (level == null) continue;
    const sent = r.escalationSteps.filter(
      (s) => s.stage === due.stage && s.dueAt.getTime() === due.dueAt.getTime() && s.level >= level,
    );
    if (sent.length) continue;
    const told = [...holder];
    if (level >= 2)
      told.push(...(holderIsHog ? ['Instruction Cell'] : hog.length ? hog : ['all HOGs']));
    if (level === 3) told.push('Instruction Cell');
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
      holder: holder.join(', '),
      told: [...new Set(told)],
    });
  }
  return out.sort((a, b) => b.level - a.level || b.daysOverdue - a.daysOverdue);
}

/** Tomorrow's 09:00 run (India time), as seen from `now`. */
export function tomorrowsRun(now: Date = new Date()): Date {
  return runTimeOf(istDay(now) + 1);
}

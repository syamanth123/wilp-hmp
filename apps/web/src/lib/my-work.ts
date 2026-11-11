import { prisma, HandoutStatus, RoleName, type Prisma } from '@hmp/db';
import { departmentScope, type DeptScopeUser } from './department-scope';
import {
  DEADLINE_SELECT,
  currentDeadline,
  deadlineInput,
  dueWords,
  formatDueDay,
  loadDeadlineConfig,
} from './deadlines';
import { awayPeopleBackedUpBy } from './away';

/**
 * v1.4.2 — "My work" (docs/plans/v1.4.2-workload.md §3): the requests that need *this person's* action now,
 * soonest due first. One list for a person with several roles, each item tagged with its role. Items of an
 * away colleague the person backs up are included, marked "for Dr X".
 */

export type WorkRole = 'HOG' | 'PC' | 'FACULTY' | 'SME' | 'IC';

export interface WorkItem {
  requestId: string;
  refNo: string;
  courseCode: string;
  courseTitle: string;
  semester: string;
  role: WorkRole;
  todo: string;
  href: string;
  dueAt: Date | null;
  dueLabel: string | null;
  dueText: string | null;
  tone: 'overdue' | 'soon' | 'ok' | null;
  forName: string | null;
}

interface Rule {
  role: WorkRole;
  status: HandoutStatus;
  todo: string;
  href: (id: string) => string;
  /** Requests where `userId` is the one to act (as themselves). */
  where: (u: DeptScopeUser) => Prisma.HandoutRequestWhereInput;
}

const S = HandoutStatus;

/** The person named on the request for the role, or — when nobody is named yet — the department rule. */
const namedOrDepartment = (r: 'HOG' | 'PC', u: DeptScopeUser): Prisma.HandoutRequestWhereInput => {
  const role = r === 'HOG' ? RoleName.HOG : RoleName.PROGRAMME_COMMITTEE;
  return {
    OR: [
      { assignees: { some: { role, userId: u.id, endedAt: null } } },
      {
        AND: [{ assignees: { none: { role, endedAt: null } } }, departmentScope(u) ?? {}],
      },
    ],
  };
};

const RULES: Rule[] = [
  {
    role: 'HOG',
    status: S.REQUESTED,
    todo: 'Allocate faculty, SME and PC',
    href: (id) => `/hog/requests/${id}`,
    where: (u) => namedOrDepartment('HOG', u),
  },
  {
    role: 'HOG',
    status: S.UNDER_REVIEW,
    todo: 'Final approval',
    href: (id) => `/hog/requests/${id}`,
    where: (u) => namedOrDepartment('HOG', u),
  },
  {
    role: 'PC',
    status: S.ALLOCATED,
    todo: 'Confirm the allocation',
    href: (id) => `/pc/requests/${id}`,
    where: (u) => namedOrDepartment('PC', u),
  },
  {
    role: 'PC',
    status: S.SUBMITTED,
    todo: 'Review the handout',
    href: (id) => `/pc/requests/${id}`,
    where: (u) => namedOrDepartment('PC', u),
  },
  {
    role: 'FACULTY',
    status: S.ASSIGNED,
    todo: 'Accept and start writing',
    href: (id) => `/faculty/assignments/${id}`,
    where: (u) => ({ assignments: { some: { facultyId: u.id, active: true } } }),
  },
  {
    role: 'FACULTY',
    status: S.IN_PROGRESS,
    todo: 'Write the handout and submit',
    href: (id) => `/faculty/assignments/${id}`,
    where: (u) => ({ assignments: { some: { facultyId: u.id, active: true } } }),
  },
  {
    role: 'FACULTY',
    status: S.REWORK_REQUESTED,
    todo: 'Revise — sent back for changes',
    href: (id) => `/faculty/assignments/${id}`,
    where: (u) => ({ assignments: { some: { facultyId: u.id, active: true } } }),
  },
  {
    role: 'SME',
    status: S.SME_REVIEW,
    todo: 'SME review',
    href: (id) => `/sme/review/${id}`,
    where: (u) => ({ smeAssignment: { smeUserId: u.id } }),
  },
  {
    role: 'IC',
    status: S.APPROVED,
    todo: 'Publish to Taxila',
    href: (id) => `/ic/requests/${id}`,
    where: () => ({}),
  },
];

const ROLE_OF: Record<WorkRole, RoleName> = {
  HOG: RoleName.HOG,
  PC: RoleName.PROGRAMME_COMMITTEE,
  FACULTY: RoleName.FACULTY,
  SME: RoleName.SME,
  IC: RoleName.INSTRUCTION_CELL,
};

const ITEM_SELECT = {
  ...DEADLINE_SELECT,
  refNo: true,
  offering: {
    select: {
      course: { select: { code: true, title: true } },
      semester: { select: { name: true, startDate: true } },
    },
  },
} as const;

export async function loadMyWork(user: DeptScopeUser, now: Date = new Date()): Promise<WorkItem[]> {
  const cfg = await loadDeadlineConfig();
  // Who I act as: myself, plus each away colleague I back up (their roles that I also hold).
  const away = await awayPeopleBackedUpBy(user.id, now);
  const actors: { as: DeptScopeUser; forName: string | null }[] = [
    { as: user, forName: null },
    ...away.map((a) => ({
      as: { id: a.id, roles: a.roles, departmentId: a.departmentId },
      forName: a.name,
    })),
  ];

  const items: WorkItem[] = [];
  const seen = new Set<string>();
  for (const actor of actors) {
    for (const rule of RULES) {
      const role = ROLE_OF[rule.role];
      if (!actor.as.roles.includes(role)) continue;
      // A back-up only covers roles they hold themselves (H18), and never faculty writing.
      if (actor.forName && (!user.roles.includes(role) || rule.role === 'FACULTY')) continue;
      const rows = await prisma.handoutRequest.findMany({
        where: { AND: [{ status: rule.status }, rule.where(actor.as)] },
        select: ITEM_SELECT,
        take: 200,
      });
      for (const r of rows) {
        const key = `${r.id}:${rule.role}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const due = currentDeadline(deadlineInput(r), cfg);
        const words = due ? dueWords(due.dueAt, now) : null;
        items.push({
          requestId: r.id,
          refNo: r.refNo,
          courseCode: r.offering.course.code,
          courseTitle: r.offering.course.title,
          semester: r.offering.semester.name,
          role: rule.role,
          todo: rule.todo,
          href: rule.href(r.id),
          dueAt: due?.dueAt ?? null,
          dueLabel: due ? formatDueDay(due.dueAt) : null,
          dueText: words?.text ?? null,
          tone: words?.tone ?? null,
          forName: actor.forName,
        });
      }
    }
  }
  items.sort((a, b) => (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity));
  return items;
}

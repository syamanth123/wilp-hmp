import { prisma, HandoutStatus, RoleName, type Prisma } from '@hmp/db';
import { loadWorkflowConfig, slaHoursFor } from './sla';

/**
 * People and their open work (v1.4, docs/plans/departments.md §B, §B2, §C). "Open work" = requests not
 * yet approved where the person is responsible now: an active faculty assignment, the SME assignment,
 * or a current RequestAssignee row (HOG / PC). Used for the Admin people list, the load shown in
 * pickers, and the impact check before a role / department change.
 */

const CLOSED: HandoutStatus[] = [
  HandoutStatus.APPROVED,
  HandoutStatus.PUBLISHED,
  HandoutStatus.ARCHIVED,
  HandoutStatus.REJECTED,
];
const openRequest: Prisma.HandoutRequestWhereInput = { status: { notIn: CLOSED } };

export type WorkRole = 'HOG' | 'PC' | 'FACULTY' | 'SME';

export interface OpenWorkItem {
  requestId: string;
  refNo: string;
  course: string;
  status: HandoutStatus;
  role: WorkRole;
  overdue: boolean;
}

export interface Load {
  open: number;
  overdue: number;
}

/** Every open item for these people, by person. */
export async function openWork(userIds: string[]): Promise<Map<string, OpenWorkItem[]>> {
  const out = new Map<string, OpenWorkItem[]>(userIds.map((id) => [id, []]));
  if (userIds.length === 0) return out;
  const select = {
    id: true,
    refNo: true,
    status: true,
    updatedAt: true,
    offering: { select: { course: { select: { code: true, title: true } } } },
  } as const;
  const [cfg, fac, sme, assignees] = await Promise.all([
    loadWorkflowConfig(),
    prisma.facultyAssignment.findMany({
      where: { facultyId: { in: userIds }, active: true, request: openRequest },
      select: { facultyId: true, request: { select } },
    }),
    prisma.smeAssignment.findMany({
      where: { smeUserId: { in: userIds }, request: openRequest },
      select: { smeUserId: true, request: { select } },
    }),
    prisma.requestAssignee.findMany({
      where: {
        userId: { in: userIds },
        endedAt: null,
        role: { in: [RoleName.HOG, RoleName.PROGRAMME_COMMITTEE] },
        request: openRequest,
      },
      select: { userId: true, role: true, request: { select } },
    }),
  ]);
  const now = Date.now();
  const add = (
    userId: string,
    role: WorkRole,
    r: {
      id: string;
      refNo: string;
      status: HandoutStatus;
      updatedAt: Date;
      offering: { course: { code: string; title: string } };
    },
  ) => {
    const sla = slaHoursFor(cfg, r.status);
    out.get(userId)?.push({
      requestId: r.id,
      refNo: r.refNo,
      course: `${r.offering.course.code} — ${r.offering.course.title}`,
      status: r.status,
      role,
      overdue: sla != null && now - r.updatedAt.getTime() >= sla * 3_600_000,
    });
  };
  for (const f of fac) add(f.facultyId, 'FACULTY', f.request);
  for (const s of sme) add(s.smeUserId, 'SME', s.request);
  for (const a of assignees) add(a.userId, a.role === RoleName.HOG ? 'HOG' : 'PC', a.request);
  return out;
}

export async function loads(userIds: string[]): Promise<Map<string, Load>> {
  const work = await openWork(userIds);
  return new Map(
    [...work].map(([id, items]) => [
      id,
      { open: items.length, overdue: items.filter((i) => i.overdue).length },
    ]),
  );
}

/** "3 open handouts · 1 overdue" (or "No open handouts"). */
export function loadText(l: Load | undefined): string {
  if (!l || l.open === 0) return 'No open handouts';
  return `${l.open} open handout${l.open === 1 ? '' : 's'}${l.overdue ? ` · ${l.overdue} overdue` : ''}`;
}

export interface PersonRow {
  id: string;
  name: string;
  email: string;
  roles: RoleName[];
  departmentId: string | null;
  departmentName: string | null;
  facultyType: string | null;
  active: boolean;
  load: Load;
}

export interface PeopleFilter {
  q?: string;
  role?: RoleName | '';
  department?: string; // id, 'none', or ''
  status?: 'active' | 'inactive' | '';
}

export async function loadPeople(f: PeopleFilter = {}): Promise<PersonRow[]> {
  const where: Prisma.UserWhereInput = {
    ...(f.q
      ? {
          OR: [
            { name: { contains: f.q, mode: 'insensitive' } },
            { email: { contains: f.q, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(f.role ? { roles: { some: { role: { name: f.role } } } } : {}),
    ...(f.department === 'none'
      ? { departmentId: null }
      : f.department
        ? { departmentId: f.department }
        : {}),
    ...(f.status === 'active'
      ? { active: true }
      : f.status === 'inactive'
        ? { active: false }
        : {}),
  };
  const users = await prisma.user.findMany({
    where,
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      email: true,
      facultyType: true,
      active: true,
      departmentId: true,
      department: { select: { name: true } },
      roles: { select: { role: { select: { name: true } } } },
    },
  });
  const load = await loads(users.map((u) => u.id));
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    roles: u.roles.map((r) => r.role.name),
    departmentId: u.departmentId,
    departmentName: u.department?.name ?? null,
    facultyType: u.facultyType,
    active: u.active,
    load: load.get(u.id) ?? { open: 0, overdue: 0 },
  }));
}

/** The active HOG of a department (the brief allows one), if any. */
export async function departmentHog(departmentId: string | null) {
  if (!departmentId) return null;
  return prisma.user.findFirst({
    where: { departmentId, active: true, roles: { some: { role: { name: RoleName.HOG } } } },
    select: { id: true, name: true, email: true },
  });
}

/**
 * Which open items a change would leave without an owner: roles taken away, a department change
 * (HOG / PC work belongs to the old department) or deactivation (everything).
 */
export function impactOfChange(
  items: OpenWorkItem[],
  change: { removedRoles: RoleName[]; departmentChanged: boolean; deactivated: boolean },
): OpenWorkItem[] {
  const roleOf: Record<WorkRole, RoleName> = {
    HOG: RoleName.HOG,
    PC: RoleName.PROGRAMME_COMMITTEE,
    FACULTY: RoleName.FACULTY,
    SME: RoleName.SME,
  };
  return items.filter(
    (i) =>
      change.deactivated ||
      change.removedRoles.includes(roleOf[i.role]) ||
      (change.departmentChanged && (i.role === 'HOG' || i.role === 'PC')),
  );
}

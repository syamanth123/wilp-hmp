import { prisma, RoleName } from '@hmp/db';
import type { SessionUser } from '@hmp/auth';
import {
  currentTermKey,
  libraryHref,
  loadAllItems,
  termLabel,
  termNames,
  termRank,
  type LibraryFilter,
  type LibraryItem,
  type StatusGroup,
} from './handout-library';
import { daysLeft } from './deadlines';
import { loads, type Load } from './people';
import { awayByUser, awayText } from './away';
import { departmentScope } from './department-scope';

/**
 * v1.4.2 — department dashboard (docs/plans/v1.4.2-workload.md §5). The numbers come from the Handout
 * Library's own items, so every number opens the Library list it counts.
 */

export type Bucket = 'notStarted' | 'inProgress' | 'overdue' | 'approved' | 'published';

export const BUCKETS: { key: Bucket; label: string }[] = [
  { key: 'notStarted', label: 'Not started' },
  { key: 'inProgress', label: 'In progress' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'approved', label: 'Approved' },
  { key: 'published', label: 'Published' },
];

const IN_PROGRESS: StatusGroup[] = [
  'allocating',
  'writing',
  'with-sme',
  'with-reviewer',
  'sent-back',
];

export interface DepartmentRow {
  id: string; // department id, or 'none'
  name: string;
  hog: string | null;
  counts: Record<Bucket, number>;
  links: Record<Bucket, string>;
}

export interface WorkloadRow {
  id: string;
  name: string;
  roles: string[];
  department: string | null;
  load: Load;
  away: string | null;
}

export interface DepartmentDashboard {
  term: string | null;
  termText: string;
  terms: { key: string; label: string }[];
  rows: DepartmentRow[];
  total: Record<Bucket, number>;
  workload: WorkloadRow[];
}

const ROLE_SHORT: Partial<Record<RoleName, string>> = {
  HOG: 'HOG',
  PROGRAMME_COMMITTEE: 'PC',
  FACULTY: 'Faculty',
  SME: 'SME',
};

function bucketOf(it: LibraryItem, now: Date): Bucket[] {
  if (it.group === 'not-started') return ['notStarted'];
  if (it.group === 'published') return ['published'];
  if (it.group === 'approved') return ['approved'];
  if (it.group && IN_PROGRESS.includes(it.group)) {
    return it.dueAt && daysLeft(it.dueAt, now) < 0 ? ['inProgress', 'overdue'] : ['inProgress'];
  }
  return [];
}

function bucketLink(b: Bucket, base: Partial<LibraryFilter>): string {
  switch (b) {
    case 'notStarted':
      return libraryHref({ ...base, tab: 'in-progress', status: 'not-started' });
    case 'inProgress':
      return libraryHref({ ...base, tab: 'in-progress' });
    case 'overdue':
      return libraryHref({ ...base, tab: 'in-progress', due: 'overdue' });
    case 'approved':
      return libraryHref({ ...base, tab: 'in-progress', status: 'approved' });
    case 'published':
      return libraryHref({ ...base, tab: 'published' });
  }
}

const zero = (): Record<Bucket, number> => ({
  notStarted: 0,
  inProgress: 0,
  overdue: 0,
  approved: 0,
  published: 0,
});

/**
 * `onlyDepartmentId`: a HOG's own department. Otherwise (IC / Admin) every department, plus a row for
 * work whose department isn't known yet.
 */
export async function loadDepartmentDashboard(
  user: SessionUser,
  opts: { term?: string | null; onlyDepartmentId?: string | null; now?: Date },
): Promise<DepartmentDashboard> {
  const now = opts.now ?? new Date();
  const names = await termNames();
  const [items, current, departments] = await Promise.all([
    loadAllItems(user, names),
    currentTermKey(now),
    prisma.department.findMany({
      where: opts.onlyDepartmentId ? { id: opts.onlyDepartmentId } : { active: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ]);
  const all = [...items['in-progress'], ...items.published];
  const termKeys = [...new Set(all.map((i) => i.termKey).filter((k): k is string => !!k))].sort(
    (a, b) => termRank(b) - termRank(a),
  );
  const term =
    opts.term && termKeys.includes(opts.term)
      ? opts.term
      : current && termKeys.includes(current)
        ? current
        : (termKeys[0] ?? null);
  const inTerm = all.filter((i) => i.termKey === term);

  const hogs = await prisma.user.findMany({
    where: {
      active: true,
      departmentId: { in: departments.map((d) => d.id) },
      roles: { some: { role: { name: RoleName.HOG } } },
    },
    select: { name: true, departmentId: true },
  });

  const rowFor = (id: string, name: string): DepartmentRow => {
    const base: Partial<LibraryFilter> = { term: term ?? '', dept: id };
    return {
      id,
      name,
      hog: id === 'none' ? null : (hogs.find((h) => h.departmentId === id)?.name ?? null),
      counts: zero(),
      links: Object.fromEntries(BUCKETS.map((b) => [b.key, bucketLink(b.key, base)])) as Record<
        Bucket,
        string
      >,
    };
  };
  const rows = departments.map((d) => rowFor(d.id, d.name));
  const none = rowFor('none', 'Department not known');
  const total = zero();
  for (const it of inTerm) {
    const targets = it.departmentIds.length
      ? rows.filter((r) => it.departmentIds.includes(r.id))
      : opts.onlyDepartmentId
        ? []
        : [none];
    for (const b of bucketOf(it, now)) {
      for (const r of targets) r.counts[b] += 1;
      if (targets.length) total[b] += 1;
    }
  }
  if (!opts.onlyDepartmentId && BUCKETS.some((b) => none.counts[b.key] > 0)) rows.push(none);

  // Workload: people with department roles in these departments (HOG / PC always; others with open work).
  const people = await prisma.user.findMany({
    where: {
      active: true,
      ...(opts.onlyDepartmentId ? { departmentId: opts.onlyDepartmentId } : {}),
      roles: {
        some: {
          role: {
            name: {
              in: [RoleName.HOG, RoleName.PROGRAMME_COMMITTEE, RoleName.FACULTY, RoleName.SME],
            },
          },
        },
      },
    },
    select: {
      id: true,
      name: true,
      department: { select: { name: true } },
      roles: { select: { role: { select: { name: true } } } },
    },
  });
  const [loadMap, away] = await Promise.all([
    loads(people.map((p) => p.id)),
    awayByUser(
      people.map((p) => p.id),
      now,
    ),
  ]);
  const workload: WorkloadRow[] = people
    .map((p) => {
      const roles = p.roles.map((r) => r.role.name);
      return {
        id: p.id,
        name: p.name,
        roles: roles.map((r) => ROLE_SHORT[r]).filter((r): r is string => !!r),
        department: p.department?.name ?? null,
        load: loadMap.get(p.id) ?? { open: 0, overdue: 0, dueThisWeek: 0 },
        away: awayText(away.get(p.id)),
        lead: roles.includes(RoleName.HOG) || roles.includes(RoleName.PROGRAMME_COMMITTEE),
      };
    })
    .filter((p) => p.load.open > 0 || p.lead || p.away)
    .sort(
      (a, b) =>
        b.load.overdue - a.load.overdue ||
        b.load.dueThisWeek - a.load.dueThisWeek ||
        b.load.open - a.load.open ||
        a.name.localeCompare(b.name),
    )
    .map(({ lead: _lead, ...rest }) => rest);

  return {
    term,
    termText: term ? (names.get(term) ?? termLabel(term)) : 'No semester yet',
    terms: termKeys.map((k) => ({ key: k, label: names.get(k) ?? termLabel(k) })),
    rows,
    total,
    workload,
  };
}

/** For a HOG: their own department (null → they see the all-departments notice instead). */
export function ownDepartment(user: SessionUser): string | null {
  return departmentScope(user) ? (user.departmentId ?? null) : null;
}

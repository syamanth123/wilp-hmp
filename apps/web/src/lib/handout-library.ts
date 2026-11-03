import { HandoutStatus, Prisma, RoleName, normalizeDibbaCourseCode, prisma } from '@hmp/db';
import type { SessionUser } from '@hmp/auth';
import {
  IN_PROGRESS_STATUSES,
  PAST_HANDOUT_SCOPE,
  PUBLISHED_STATUSES,
  libraryScope,
  seesAllWork,
  type LibraryTab,
} from './handout-access';

/**
 * The Handout Library list (docs/plans/handout-library.md §2).
 *
 * ONE slim query per tab fetches every row the user may see (no handout content); search, filters,
 * facet counts, quick-view counts, grouping by course, sorting and the page slice are all computed
 * from that one result — so every count on the page equals the list it describes.
 */

export type Tab = LibraryTab | 'past';
export const TABS: Tab[] = ['published', 'in-progress', 'past'];
export const PAGE_SIZE = 25;

export interface LibraryFilter {
  tab: Tab;
  q: string;
  /** `${year}-${FIRST|SECOND|SUMMER}`, or 'all'. */
  term: string;
  programme: string;
  status: HandoutStatus | '';
  view: string;
  page: number;
}

/** One handout in a list (HMP or past BITS). */
export interface LibraryItem {
  kind: 'hmp' | 'past';
  id: string;
  courseKey: string;
  courseCode: string;
  courseTitle: string;
  refNo: string | null;
  status: HandoutStatus | null;
  termKey: string | null;
  semesterName: string;
  programmeCode: string | null;
  faculty: string[];
  sme: string | null;
  updatedAt: Date;
}

export interface LibraryGroup {
  latest: LibraryItem;
  /** Other handouts for the same course in this list. */
  olderCount: number;
}

export interface QuickView {
  key: string;
  label: string;
  /** Applied on top of the tab: a filter preset. */
  term?: 'current' | 'all';
  statuses?: HandoutStatus[];
}

export interface Facet {
  value: string;
  label: string;
  count: number;
}

const S = HandoutStatus;

// ── Terms ───────────────────────────────────────────────────────────────────

const TERM_WORD: Record<string, string> = { FIRST: 'Sem 1', SECOND: 'Sem 2', SUMMER: 'Summer' };

export const termKey = (year: number, term: string) => `${year}-${term}`;

export function termLabel(key: string): string {
  const [y, t] = key.split('-');
  const year = Number(y);
  return Number.isFinite(year) ? `${year}-${String(year + 1).slice(2)} ${TERM_WORD[t!] ?? t}` : key;
}

/** The current term: the Course Dibba term whose dates contain today, else the latest one. */
export async function currentTermKey(now: Date = new Date()): Promise<string | null> {
  const t =
    (await prisma.academicTerm.findFirst({
      where: { startDate: { lte: now }, endDate: { gte: now } },
      orderBy: { startDate: 'desc' },
    })) ?? (await prisma.academicTerm.findFirst({ orderBy: { startDate: 'desc' } }));
  return t ? termKey(t.year, t.term) : null;
}

// ── Quick views (role-aware; the first one is the role's default) ───────────

export function quickViews(roles: readonly RoleName[], tab: Tab): QuickView[] {
  if (tab === 'past') return [];
  const oversight = seesAllWork({ id: '', roles: [...roles] });
  if (tab === 'published') {
    return [
      { key: 'this-term', label: 'This semester', term: 'current' },
      {
        key: 'not-published',
        label: 'Approved, not yet published',
        term: 'all',
        statuses: [S.APPROVED],
      },
      { key: 'published', label: 'Published', term: 'all', statuses: [S.PUBLISHED] },
      { key: 'all', label: 'All semesters', term: 'all' },
    ];
  }
  if (oversight) {
    return [
      { key: 'this-term', label: 'This semester', term: 'current' },
      { key: 'with-sme', label: 'With subject expert', term: 'all', statuses: [S.SME_REVIEW] },
      {
        key: 'sent-back',
        label: 'Sent back for changes',
        term: 'all',
        statuses: [S.REWORK_REQUESTED],
      },
      { key: 'all', label: 'All semesters', term: 'all' },
    ];
  }
  return [
    {
      key: 'needs-action',
      label:
        roles.includes(RoleName.SME) && !roles.includes(RoleName.FACULTY)
          ? 'Waiting for my review'
          : 'Needs my action',
      term: 'all',
      statuses: roles.includes(RoleName.FACULTY)
        ? [S.ASSIGNED, S.IN_PROGRESS, S.REWORK_REQUESTED]
        : [S.SME_REVIEW],
    },
    {
      key: 'sent-back',
      label: 'Sent back for changes',
      term: 'all',
      statuses: [S.REWORK_REQUESTED],
    },
    { key: 'all', label: 'All my handouts', term: 'all' },
  ];
}

// ── Address ↔ filter ─────────────────────────────────────────────────────────

/** Faculty and SMEs open on their own work; everyone else on the published list. */
export function defaultTab(roles: readonly RoleName[]): Tab {
  return seesAllWork({ id: '', roles: [...roles] }) ? 'published' : 'in-progress';
}

export function parseLibraryFilter(
  sp: Record<string, string | undefined>,
  roles: readonly RoleName[],
): LibraryFilter {
  const tab = (TABS as string[]).includes(sp.tab ?? '') ? (sp.tab as Tab) : defaultTab(roles);
  const status = (Object.values(HandoutStatus) as string[]).includes(sp.status ?? '')
    ? (sp.status as HandoutStatus)
    : '';
  const term = sp.term && /^(all|\d{4}-(FIRST|SECOND|SUMMER))$/.test(sp.term) ? sp.term : '';
  // A quick view from the address; otherwise the role's default — unless a valid semester or
  // status was picked by hand (then no quick view is highlighted).
  const views = quickViews(roles, tab);
  const view =
    views.find((v) => v.key === sp.view)?.key ?? (term || status ? '' : (views[0]?.key ?? ''));
  return {
    tab,
    q: (sp.q ?? '').slice(0, 100),
    term,
    programme: (sp.programme ?? '').slice(0, 40),
    status,
    view,
    page: Math.max(1, parseInt(sp.page ?? '1', 10) || 1),
  };
}

export function libraryHref(f: Partial<LibraryFilter>): string {
  const p = new URLSearchParams();
  if (f.tab) p.set('tab', f.tab);
  if (f.view) p.set('view', f.view);
  if (f.q) p.set('q', f.q);
  if (f.term) p.set('term', f.term);
  if (f.programme) p.set('programme', f.programme);
  if (f.status) p.set('status', f.status);
  if (f.page && f.page > 1) p.set('page', String(f.page));
  const s = p.toString();
  return `/handouts${s ? `?${s}` : ''}`;
}

// ── Search ───────────────────────────────────────────────────────────────────

const fold = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** The canonical course code when the query is one (normalizeDibbaCourseCode throws otherwise). */
function asCourseCode(q: string): string | null {
  try {
    return normalizeDibbaCourseCode(q);
  } catch {
    return null;
  }
}

/** "ss zg 653", "SSZG653" and "SS ZG653" all find SS ZG653; titles and names ignore case/accents. */
export function matchesSearch(item: LibraryItem, q: string): boolean {
  const query = fold(q);
  if (!query) return true;
  const code = asCourseCode(q);
  if (code && fold(item.courseCode).replace(/ /g, '').includes(fold(code).replace(/ /g, '')))
    return true;
  const hay = fold(
    [item.courseCode, item.courseTitle, item.refNo ?? '', ...item.faculty, item.sme ?? ''].join(
      ' | ',
    ),
  );
  return hay.includes(query) || hay.replace(/ /g, '').includes(query.replace(/ /g, ''));
}

// ── Pure list maths (unit-tested) ────────────────────────────────────────────

export interface Applied {
  q: string;
  termKey: string | null; // null = all terms
  programme: string;
  statuses: HandoutStatus[] | null; // null = any
}

export function applyFilters(
  items: LibraryItem[],
  a: Applied,
  skip?: keyof Applied,
): LibraryItem[] {
  return items.filter(
    (it) =>
      (skip === 'q' || matchesSearch(it, a.q)) &&
      (skip === 'termKey' || !a.termKey || it.termKey === a.termKey) &&
      (skip === 'programme' || !a.programme || it.programmeCode === a.programme) &&
      (skip === 'statuses' ||
        !a.statuses ||
        (it.status !== null && a.statuses.includes(it.status))),
  );
}

/** One row per course: its most recently updated handout + how many others the list holds. */
export function groupByCourse(items: LibraryItem[]): LibraryGroup[] {
  const by = new Map<string, LibraryItem[]>();
  for (const it of items) by.set(it.courseKey, [...(by.get(it.courseKey) ?? []), it]);
  return [...by.values()]
    .map((list) => {
      const sorted = [...list].sort((x, y) => y.updatedAt.getTime() - x.updatedAt.getTime());
      return { latest: sorted[0]!, olderCount: sorted.length - 1 };
    })
    .sort((x, y) => y.latest.updatedAt.getTime() - x.latest.updatedAt.getTime());
}

export function countBy(
  items: LibraryItem[],
  key: (it: LibraryItem) => string | null,
): Map<string, number> {
  const m = new Map<string, number>();
  for (const it of items) {
    const k = key(it);
    if (k) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

// ── Loading ──────────────────────────────────────────────────────────────────

type ScopeUser = Pick<SessionUser, 'id' | 'roles'>;

async function loadHmpItems(user: ScopeUser, tab: LibraryTab): Promise<LibraryItem[]> {
  const rows = await prisma.handoutRequest.findMany({
    where: libraryScope(user, tab),
    select: {
      id: true,
      refNo: true,
      status: true,
      updatedAt: true,
      offering: {
        select: {
          course: { select: { id: true, bitsCourseNumber: true, title: true } },
          semester: {
            select: { name: true, year: true, term: true, programme: { select: { code: true } } },
          },
        },
      },
      assignments: { where: { active: true }, select: { faculty: { select: { name: true } } } },
      smeAssignment: { select: { smeUser: { select: { name: true } } } },
    },
  });
  return rows.map((r) => ({
    kind: 'hmp',
    id: r.id,
    courseKey: r.offering.course.bitsCourseNumber,
    courseCode: r.offering.course.bitsCourseNumber,
    courseTitle: r.offering.course.title,
    refNo: r.refNo,
    status: r.status,
    termKey: termKey(r.offering.semester.year, r.offering.semester.term),
    semesterName: r.offering.semester.name,
    programmeCode: r.offering.semester.programme.code,
    faculty: r.assignments.map((a) => a.faculty.name),
    sme: r.smeAssignment?.smeUser.name ?? null,
    updatedAt: r.updatedAt,
  }));
}

async function loadPastItems(): Promise<LibraryItem[]> {
  // Title / instructor / semester live inside the stored handout; read just those paths.
  const ids = (
    await prisma.handoutImport.findMany({ where: PAST_HANDOUT_SCOPE, select: { id: true } })
  ).map((r) => r.id);
  if (ids.length === 0) return [];
  const rows = await prisma.$queryRaw<
    {
      id: string;
      code: string | null;
      title: string | null;
      sem: string | null;
      inst: string | null;
      at: Date;
    }[]
  >(Prisma.sql`
    SELECT id, "bitsCourseNumber" AS code,
           data->'partA'->>'courseTitle' AS title,
           data->'metadata'->>'semester' AS sem,
           data->'partA'->'instructors'->>0 AS inst,
           COALESCE("approvedAt", "importedAt") AS at
    FROM "HandoutImport" WHERE id IN (${Prisma.join(ids)})`);
  return rows.map((r) => ({
    kind: 'past',
    id: r.id,
    courseKey: r.code ?? `past:${r.id}`,
    courseCode: r.code ?? '—',
    courseTitle: r.title ?? 'Untitled handout',
    refNo: null,
    status: null,
    termKey: null,
    semesterName: r.sem ?? '',
    programmeCode: null,
    faculty: r.inst ? [r.inst] : [],
    sme: null,
    updatedAt: r.at,
  }));
}

export interface LibraryPage {
  filter: LibraryFilter;
  currentTerm: string | null;
  tabCounts: Record<Tab, number>;
  views: (QuickView & { count: number; active: boolean })[];
  groups: LibraryGroup[];
  totalGroups: number;
  totalItems: number;
  facets: { status: Facet[]; term: Facet[]; programme: Facet[] };
}

function resolve(
  f: LibraryFilter,
  view: QuickView | undefined,
  currentTerm: string | null,
): Applied {
  const term = f.term || (view?.term === 'current' ? (currentTerm ?? 'all') : 'all');
  return {
    q: f.q,
    termKey: term === 'all' ? null : term,
    programme: f.programme,
    statuses: f.status ? [f.status] : (view?.statuses ?? null),
  };
}

export async function loadLibrary(
  user: ScopeUser,
  f: LibraryFilter,
  statusLabel: (s: HandoutStatus) => string,
): Promise<LibraryPage> {
  const [published, inProgress, past, currentTerm] = await Promise.all([
    loadHmpItems(user, 'published'),
    loadHmpItems(user, 'in-progress'),
    loadPastItems(),
    currentTermKey(),
  ]);
  const byTab: Record<Tab, LibraryItem[]> = { published, 'in-progress': inProgress, past };
  const items = byTab[f.tab];
  const views = quickViews(user.roles, f.tab);
  const view = views.find((v) => v.key === f.view);
  const applied = resolve(f, view, currentTerm);
  const visible = applyFilters(items, applied);
  const groups = groupByCourse(visible);

  const tabCounts = Object.fromEntries(
    TABS.map((t) => {
      const v = quickViews(user.roles, t)[0];
      const a =
        t === f.tab
          ? applied
          : resolve({ ...f, tab: t, view: v?.key ?? '', status: '', term: '' }, v, currentTerm);
      return [
        t,
        groupByCourse(applyFilters(byTab[t], { ...a, q: f.q, programme: f.programme })).length,
      ];
    }),
  ) as Record<Tab, number>;

  const facet = (
    skip: keyof Applied,
    key: (it: LibraryItem) => string | null,
    label: (v: string) => string,
  ) =>
    [...countBy(applyFilters(items, applied, skip), key).entries()]
      .map(([value, count]) => ({ value, label: label(value), count }))
      .sort((x, y) => x.label.localeCompare(y.label));

  const statusOrder = [...IN_PROGRESS_STATUSES, ...PUBLISHED_STATUSES] as string[];
  return {
    filter: f,
    currentTerm,
    tabCounts,
    views: views.map((v) => ({
      ...v,
      count: groupByCourse(
        applyFilters(items, resolve({ ...f, view: v.key, status: '', term: '' }, v, currentTerm)),
      ).length,
      active: v.key === f.view && !f.status && !f.term,
    })),
    groups: groups.slice((f.page - 1) * PAGE_SIZE, f.page * PAGE_SIZE),
    totalGroups: groups.length,
    totalItems: visible.length,
    facets: {
      status: facet(
        'statuses',
        (it) => it.status,
        (v) => statusLabel(v as HandoutStatus),
      ).sort((x, y) => statusOrder.indexOf(x.value) - statusOrder.indexOf(y.value)),
      term: facet('termKey', (it) => it.termKey, termLabel),
      programme: facet(
        'programme',
        (it) => it.programmeCode,
        (v) => v,
      ),
    },
  };
}

import {
  DibbaCourseType,
  HandoutStatus,
  Prisma,
  RoleName,
  normalizeDibbaCourseCode,
  prisma,
} from '@hmp/db';
import type { SessionUser } from '@hmp/auth';
import { libraryScope, seesAllWork, type LibraryTab } from './handout-access';
import { VIEWS } from './request-views';
import { loadWorkflowConfig, slaHoursFor } from './sla';
import type { ChangeSize } from './handout-compare';
import { displayCourseTitle } from './course-title';
import { formatDate } from './format-date';

/**
 * The Handout Library list (docs/plans/handout-library.md §2).
 *
 * ONE slim load per tab fetches every row the user may see (no handout content); search, filters,
 * facet counts, quick-view and tab counts, grouping by course, sorting and the page slice are all
 * computed from that one result — so every count on the page equals the list it leads to.
 */

export type Tab = LibraryTab | 'past';
export const TABS: Tab[] = ['published', 'in-progress', 'past'];
export const PAGE_SIZE = 25;
const DAY = 86_400_000;

// ── Status in plain words, grouped (brief §B) ───────────────────────────────

export type StatusGroup =
  | 'not-started'
  | 'allocating'
  | 'writing'
  | 'with-sme'
  | 'with-reviewer'
  | 'sent-back'
  | 'approved'
  | 'published'
  | 'archived'
  | 'draft'
  | 'rejected';

const S = HandoutStatus;
const DOT = { gray: '#9ca3af', navy: '#1e2a5c', gold: '#f5a623', red: '#d63b3b', green: '#2f8a57' };

export interface StatusGroupMeta {
  key: StatusGroup;
  label: string;
  dot: string;
  statuses: HandoutStatus[];
  /** Never in a list unless picked in the status filter or asked for by a quick view (D2). */
  hiddenByDefault?: boolean;
}

export const STATUS_GROUPS: StatusGroupMeta[] = [
  {
    key: 'not-started',
    label: 'Not started (in the schedule, no handout)',
    dot: DOT.gray,
    statuses: [],
    hiddenByDefault: true,
  },
  {
    key: 'allocating',
    label: 'Being allocated',
    dot: DOT.navy,
    statuses: [S.REQUESTED, S.ALLOCATED],
  },
  { key: 'writing', label: 'Being written', dot: DOT.gold, statuses: [S.ASSIGNED, S.IN_PROGRESS] },
  { key: 'with-sme', label: 'With subject expert', dot: DOT.gold, statuses: [S.SME_REVIEW] },
  {
    key: 'with-reviewer',
    label: 'With reviewer (PC / HOG)',
    dot: DOT.gold,
    statuses: [S.SUBMITTED, S.UNDER_REVIEW],
  },
  {
    key: 'sent-back',
    label: 'Sent back for changes',
    dot: DOT.red,
    statuses: [S.REWORK_REQUESTED],
  },
  {
    key: 'approved',
    label: 'Approved – not yet published',
    dot: DOT.green,
    statuses: [S.APPROVED],
  },
  { key: 'published', label: 'Published', dot: DOT.navy, statuses: [S.PUBLISHED] },
  { key: 'archived', label: 'Archived', dot: DOT.gray, statuses: [S.ARCHIVED] },
  {
    key: 'draft',
    label: 'Draft – never started',
    dot: DOT.gray,
    statuses: [S.DRAFT],
    hiddenByDefault: true,
  },
  {
    key: 'rejected',
    label: 'Rejected',
    dot: DOT.red,
    statuses: [S.REJECTED],
    hiddenByDefault: true,
  },
];
const GROUP_ORDER = STATUS_GROUPS.map((g) => g.key);
const HIDDEN_GROUPS = STATUS_GROUPS.filter((g) => g.hiddenByDefault).map((g) => g.key);

export const groupMeta = (k: StatusGroup): StatusGroupMeta =>
  STATUS_GROUPS.find((g) => g.key === k)!;

export function statusGroupOf(status: HandoutStatus, published: boolean): StatusGroup {
  if (status === S.APPROVED && published) return 'published';
  return STATUS_GROUPS.find((g) => g.statuses.includes(status))?.key ?? 'writing';
}

// ── Items ────────────────────────────────────────────────────────────────────

export interface ScheduleSlot {
  slot: number;
  day: string | null;
  session: string | null;
  type: DibbaCourseType;
}

/** One handout in a list (HMP, past BITS, or a scheduled course with no handout yet). */
export interface LibraryItem {
  kind: 'hmp' | 'past' | 'not-started';
  id: string;
  courseKey: string;
  courseCode: string;
  /** Every code the course goes by (cross-listings), canonical form. */
  codes: string[];
  courseTitle: string;
  refNo: string | null;
  status: HandoutStatus | null;
  group: StatusGroup | null;
  termKey: string | null;
  semesterName: string;
  programmeCode: string | null;
  /** Course Dibba programme codes (scheduled courses with no handout). */
  programmes: string[];
  discipline: string | null;
  faculty: string[];
  facultyIds: string[];
  sme: string | null;
  smeId: string | null;
  allocatedBy: string | null;
  allocatedById: string | null;
  updatedAt: Date;
  /** When the current step is due (workflow deadlines, lib/sla.ts). */
  dueAt: Date | null;
  publishedAt: Date | null;
  /** Published-tab items: was it sent to Taxila? */
  taxila: 'sent' | 'export' | 'none' | null;
  sentBack: number;
  /** On the user's own work (active faculty assignment or assigned SME). */
  mine: boolean;
  reviewedByMe: boolean;
  schedule: ScheduleSlot[];
  /** Worked out on demand only (decision D4). */
  changeSize?: ChangeSize | null;
}

export interface LibraryGroup {
  latest: LibraryItem;
  /** Other handouts for the same course in this list. */
  olderCount: number;
}

// ── Terms ────────────────────────────────────────────────────────────────────

const TERM_WORD: Record<string, string> = { FIRST: 'Sem 1', SECOND: 'Sem 2', SUMMER: 'Summer' };
const TERM_ORDER = ['FIRST', 'SECOND', 'SUMMER'];

export const termKey = (year: number, term: string) => `${year}-${term}`;

export function termLabel(key: string): string {
  const [y, t] = key.split('-');
  const year = Number(y);
  return Number.isFinite(year) ? `${year}-${String(year + 1).slice(2)} ${TERM_WORD[t!] ?? t}` : key;
}

/** Sortable number for a term key (later terms are bigger); unknown → -1. */
export function termRank(key: string | null): number {
  if (!key) return -1;
  const [y, t] = key.split('-');
  const i = TERM_ORDER.indexOf(t ?? '');
  return Number(y) * 3 + (i < 0 ? 0 : i);
}

/** "First Semester 2025-2026", "SECOND SEM 2024-25", "Summer Term 2023" → a term key. */
export function termKeyFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  const year = /(\d{4})/.exec(text)?.[1];
  if (!year) return null;
  const t = text.toLowerCase();
  const term = /summer/.test(t)
    ? 'SUMMER'
    : /\b(second|2nd|ii)\b|\bsem(ester)?[\s-]*(2|ii)\b/.test(t)
      ? 'SECOND'
      : /\b(first|1st|i)\b|\bsem(ester)?[\s-]*(1|i)\b/.test(t)
        ? 'FIRST'
        : null;
  return term ? termKey(Number(year), term) : null;
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

/** Real names for terms: the HMP semester name ("Sem-I 2025-26") when there is one. */
export async function termNames(): Promise<Map<string, string>> {
  const rows = await prisma.semester.findMany({
    select: { name: true, year: true, term: true },
    orderBy: { name: 'asc' },
  });
  const m = new Map<string, string>();
  for (const r of rows) {
    const k = termKey(r.year, r.term);
    if (!m.has(k)) m.set(k, r.name);
  }
  return m;
}

// ── Address ↔ filter ─────────────────────────────────────────────────────────

export type SortKey = 'updated' | 'due' | 'code' | 'status' | 'semester';
export const SORTS: { key: SortKey; label: string; dir: 'asc' | 'desc' }[] = [
  { key: 'updated', label: 'Last updated', dir: 'desc' },
  { key: 'due', label: 'Due', dir: 'asc' },
  { key: 'code', label: 'Course code', dir: 'asc' },
  { key: 'status', label: 'Status', dir: 'asc' },
  { key: 'semester', label: 'Semester', dir: 'desc' },
];

/** Filter keys kept in the address (and in saved views), in this order. */
export const FILTER_KEYS = [
  'q',
  'term',
  'programme',
  'discipline',
  'status',
  'faculty',
  'sme',
  'by',
  'due',
  'dueFrom',
  'dueTo',
  'updated',
  'updatedFrom',
  'updatedTo',
  'published',
  'publishedFrom',
  'publishedTo',
  'slot',
  'day',
  'session',
  'ctype',
  'sched',
  'taxila',
  'sentback',
  'changed',
] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

export type LibraryFilter = {
  tab: Tab;
  view: string;
  sort: SortKey;
  dir: '' | 'asc' | 'desc';
  page: number;
} & Record<FilterKey, string>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[\w-]{1,40}$/;
const ALLOWED: Record<FilterKey, (v: string) => boolean> = {
  q: () => true,
  term: (v) => /^(all|current|\d{4}-(FIRST|SECOND|SUMMER))$/.test(v),
  programme: (v) => /^[\w/ .-]{1,40}$/.test(v),
  discipline: (v) => /^[A-Z]{1,8}$/.test(v),
  status: (v) => (GROUP_ORDER as string[]).includes(v),
  faculty: (v) => ID_RE.test(v),
  sme: (v) => ID_RE.test(v),
  by: (v) => ID_RE.test(v),
  due: (v) => ['overdue', '7d', '30d'].includes(v),
  dueFrom: (v) => DATE_RE.test(v),
  dueTo: (v) => DATE_RE.test(v),
  updated: (v) => ['today', '7d', '30d'].includes(v),
  updatedFrom: (v) => DATE_RE.test(v),
  updatedTo: (v) => DATE_RE.test(v),
  published: (v) => ['7d', '30d', '90d'].includes(v),
  publishedFrom: (v) => DATE_RE.test(v),
  publishedTo: (v) => DATE_RE.test(v),
  slot: (v) => /^[0-8]$/.test(v),
  day: (v) => ['SAT', 'SUN', 'FRI'].includes(v),
  session: (v) => ['FN', 'AN', 'EV'].includes(v),
  ctype: (v) => (Object.values(DibbaCourseType) as string[]).includes(v),
  sched: (v) => ['yes', 'no'].includes(v),
  taxila: (v) => ['sent', 'export', 'none'].includes(v),
  sentback: (v) => ['1', '2', '3'].includes(v),
  changed: (v) => ['none', 'small', 'medium', 'large'].includes(v),
};

/** People filters are for the oversight roles only (faculty / SME get none beyond themselves). */
export const PEOPLE_KEYS: FilterKey[] = ['faculty', 'sme', 'by'];

export const EMPTY_FILTERS = Object.fromEntries(FILTER_KEYS.map((k) => [k, ''])) as Record<
  FilterKey,
  string
>;

/** Which tab a filter means something on. */
const FILTER_TABS: Record<FilterKey, Tab[]> = {
  q: ['published', 'in-progress', 'past'],
  term: ['published', 'in-progress', 'past'],
  programme: ['published', 'in-progress'],
  discipline: ['published', 'in-progress', 'past'],
  status: ['published', 'in-progress'],
  faculty: ['published', 'in-progress'],
  sme: ['published', 'in-progress'],
  by: ['published', 'in-progress'],
  due: ['in-progress'],
  dueFrom: ['in-progress'],
  dueTo: ['in-progress'],
  updated: ['published', 'in-progress'],
  updatedFrom: ['published', 'in-progress'],
  updatedTo: ['published', 'in-progress'],
  published: ['published'],
  publishedFrom: ['published'],
  publishedTo: ['published'],
  slot: ['published', 'in-progress'],
  day: ['published', 'in-progress'],
  session: ['published', 'in-progress'],
  ctype: ['published', 'in-progress'],
  sched: ['published', 'in-progress'],
  taxila: ['published'],
  sentback: ['published', 'in-progress'],
  changed: ['published', 'in-progress'],
};
export const appliesTo = (k: FilterKey, tab: Tab) => FILTER_TABS[k].includes(tab);

/** True when the address carries nothing at all (the role's default view applies). */
export function isBareAddress(sp: Record<string, string | undefined>): boolean {
  return Object.values(sp).every((v) => !v);
}

export function parseLibraryFilter(
  sp: Record<string, string | undefined>,
  roles: readonly RoleName[],
): LibraryFilter {
  const views = quickViews(roles);
  const fromAddress = views.find((v) => v.key === sp.view && !v.href);
  const view = fromAddress ?? (isBareAddress(sp) ? views[0] : undefined);
  const tab = (TABS as string[]).includes(sp.tab ?? '')
    ? (sp.tab as Tab)
    : (view?.tab ?? defaultTab(roles));
  const oversight = seesAllWork({ id: '', roles: [...roles] });
  const filters = { ...EMPTY_FILTERS };
  for (const k of FILTER_KEYS) {
    const raw = (sp[k] ?? '').trim();
    if (!raw) continue;
    if (k === 'q') filters.q = raw.slice(0, 100);
    else if (ALLOWED[k](raw) && (oversight || !PEOPLE_KEYS.includes(k))) filters[k] = raw;
  }
  return {
    tab,
    view: view && view.tab === tab ? view.key : '',
    sort: SORTS.find((s) => s.key === sp.sort)?.key ?? 'updated',
    dir: sp.dir === 'asc' || sp.dir === 'desc' ? sp.dir : '',
    page: Math.max(1, parseInt(sp.page ?? '1', 10) || 1),
    ...filters,
  };
}

export function libraryQuery(f: Partial<LibraryFilter>): string {
  const p = new URLSearchParams();
  if (f.tab) p.set('tab', f.tab);
  if (f.view) p.set('view', f.view);
  for (const k of FILTER_KEYS) if (f[k]) p.set(k, f[k]!);
  if (f.sort && f.sort !== 'updated') p.set('sort', f.sort);
  if (f.dir) p.set('dir', f.dir);
  if (f.page && f.page > 1) p.set('page', String(f.page));
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Address for a filter state. Only non-empty values are written. */
export function libraryHref(f: Partial<LibraryFilter>): string {
  return `/handouts${libraryQuery(f)}`;
}

/** The filters a tab or quick-view link carries along (not status: a view sets its own). */
export function carriedFilters(f: LibraryFilter, tab: Tab): Partial<LibraryFilter> {
  const out: Partial<LibraryFilter> = {};
  for (const k of FILTER_KEYS) if (f[k] && k !== 'status' && appliesTo(k, tab)) out[k] = f[k];
  return out;
}

// ── Quick views (role-aware; the first one is the role's default) ───────────

export interface ViewCtx {
  now: Date;
  userId: string;
  /** The user's own course codes (faculty "last year's handout"). */
  myCourseCodes: Set<string>;
  currentTerm: string | null;
}

export interface QuickView {
  key: string;
  label: string;
  tab: Tab;
  /** The semester the view looks at when the address doesn't pick one. */
  term: 'current' | 'all';
  /** Status groups the view lets through (default: all but the hidden-by-default ones). */
  groups?: StatusGroup[];
  test?: (it: LibraryItem, ctx: ViewCtx) => boolean;
  /** Needs the "changed vs last year" size (worked out on demand, decision D4). */
  needsChange?: boolean;
  /** A link out of the library instead of a list (Admin: corpus approvals). */
  href?: string;
}

/** "Needs my action" = the dashboards' action cards (lib/request-views.ts) — one shared rule. */
function needsActionTest(roles: readonly RoleName[]) {
  const statusesOf = (role: keyof typeof VIEWS, keys: string[]) =>
    VIEWS[role].filter((v) => keys.includes(v.key)).flatMap((v) => v.statuses);
  const anyone = [
    ...(roles.includes(RoleName.HOG)
      ? statusesOf('HOG', ['pending-allocation', 'final-approval'])
      : []),
    ...(roles.includes(RoleName.PROGRAMME_COMMITTEE)
      ? statusesOf('PC', ['awaiting-confirmation', 'awaiting-review'])
      : []),
  ];
  const fac = roles.includes(RoleName.FACULTY)
    ? statusesOf('FACULTY', ['to-accept', 'in-progress'])
    : [];
  const sme = roles.includes(RoleName.SME) ? statusesOf('SME', ['awaiting']) : [];
  return (it: LibraryItem, ctx: ViewCtx) => {
    if (!it.status) return false;
    if (anyone.includes(it.status)) return true;
    if (fac.includes(it.status) && it.facultyIds.includes(ctx.userId)) return true;
    return sme.includes(it.status) && it.smeId === ctx.userId;
  };
}

const isOverdue = (it: LibraryItem, ctx: ViewCtx) => !!it.dueAt && it.dueAt < ctx.now;

/** The brief's role table (§A), in role order; the first view is where the role lands. */
export function quickViews(roles: readonly RoleName[]): QuickView[] {
  const has = (r: RoleName) => roles.includes(r);
  const out: QuickView[] = [];
  const add = (...vs: QuickView[]) => {
    for (const v of vs) if (!out.some((o) => o.key === v.key)) out.push(v);
  };
  const needsAction: QuickView = {
    key: 'needs-action',
    label:
      has(RoleName.SME) &&
      !has(RoleName.FACULTY) &&
      !has(RoleName.HOG) &&
      !has(RoleName.PROGRAMME_COMMITTEE)
        ? 'Waiting for my review'
        : 'Needs my action',
    tab: 'in-progress',
    term: 'all',
    test: needsActionTest(roles),
  };
  const overdue: QuickView = {
    key: 'overdue',
    label: 'Overdue',
    tab: 'in-progress',
    term: 'all',
    test: isOverdue,
  };
  const sentBack: QuickView = {
    key: 'sent-back',
    label: 'Sent back for changes',
    tab: 'in-progress',
    term: 'all',
    groups: ['sent-back'],
  };
  const notPublished: QuickView = {
    key: 'not-published',
    label: 'Approved, not yet published',
    tab: 'published',
    term: 'all',
    groups: ['approved'],
  };
  const minePublished: QuickView = {
    key: 'mine-published',
    label: 'Published (mine)',
    tab: 'published',
    term: 'all',
    test: (it) => it.mine,
  };
  const ic: QuickView[] = [
    { key: 'this-term', label: 'This semester', tab: 'in-progress', term: 'current' },
    {
      key: 'not-started',
      label: 'Not started yet',
      tab: 'in-progress',
      term: 'current',
      groups: ['not-started'],
    },
    overdue,
    notPublished,
    {
      key: 'published-week',
      label: 'Published this week',
      tab: 'published',
      term: 'all',
      test: (it, c) => !!it.publishedAt && it.publishedAt.getTime() >= c.now.getTime() - 7 * DAY,
    },
  ];
  if (has(RoleName.ADMIN)) {
    add(...ic, {
      key: 'corpus-awaiting',
      label: 'Past BITS handouts awaiting approval',
      tab: 'past',
      term: 'all',
      href: '/admin/corpus-imports',
    });
  }
  if (has(RoleName.INSTRUCTION_CELL)) add(...ic);
  if (has(RoleName.HOG) || has(RoleName.PROGRAMME_COMMITTEE)) {
    add(needsAction, overdue, sentBack, notPublished, {
      key: 'changed-a-lot',
      label: 'Changed a lot since last year',
      tab: 'in-progress',
      term: 'all',
      needsChange: true,
      test: (it) => it.changeSize === 'large',
    });
  }
  if (has(RoleName.FACULTY)) {
    add(
      needsAction,
      {
        key: 'due-week',
        label: 'Due this week',
        tab: 'in-progress',
        term: 'all',
        test: (it, c) => it.mine && !!it.dueAt && it.dueAt.getTime() <= c.now.getTime() + 7 * DAY,
      },
      sentBack,
      minePublished,
      {
        key: 'last-year',
        label: 'Last year’s handout for my courses',
        tab: 'past',
        term: 'all',
        test: (it, c) => it.codes.some((code) => c.myCourseCodes.has(code)),
      },
    );
  }
  if (has(RoleName.SME)) {
    add(
      needsAction,
      {
        key: 'reviewed',
        label: 'Reviewed by me',
        tab: 'in-progress',
        term: 'all',
        test: (it) => it.reviewedByMe,
      },
      minePublished,
    );
  }
  return out;
}

/** The tab a role lands on (its default view's tab). */
export function defaultTab(roles: readonly RoleName[]): Tab {
  return quickViews(roles)[0]?.tab ?? 'published';
}

// ── Search ───────────────────────────────────────────────────────────────────

export const fold = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** The canonical course code when the query is one (normalizeDibbaCourseCode throws otherwise). */
export function asCourseCode(q: string): string | null {
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
  const squash = (s: string) => fold(s).replace(/ /g, '');
  const code = asCourseCode(q);
  if (code && item.codes.some((c) => squash(c).includes(squash(code)))) return true;
  const hay = fold(
    [...item.codes, item.courseTitle, item.refNo ?? '', ...item.faculty, item.sme ?? ''].join(
      ' | ',
    ),
  );
  return hay.includes(query) || hay.replace(/ /g, '').includes(query.replace(/ /g, ''));
}

// ── Filters as predicates (unit-tested) ──────────────────────────────────────

const IST = 5.5 * 3_600_000;
/** India-time midnight of "YYYY-MM-DD" (or the next midnight, for an inclusive "to"). */
function istDay(ymd: string, end = false): number {
  return Date.parse(`${ymd}T00:00:00+05:30`) + (end ? DAY : 0);
}
function istTodayStart(now: Date): number {
  const ist = new Date(now.getTime() + IST);
  return Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST;
}
function inRange(d: Date | null, from: string, to: string): boolean {
  if (!from && !to) return true;
  if (!d) return false;
  const t = d.getTime();
  return (!from || t >= istDay(from)) && (!to || t < istDay(to, true));
}

export type Pred = (it: LibraryItem) => boolean;
export interface KeyedPred {
  key: FilterKey | 'view';
  test: Pred;
}

/** Every predicate a list applies, keyed by the filter it belongs to (facets skip their own). */
export function predicates(
  f: LibraryFilter,
  view: QuickView | undefined,
  ctx: ViewCtx,
  tab: Tab = f.tab,
): KeyedPred[] {
  const out: KeyedPred[] = [];
  const now = ctx.now.getTime();
  const v = (k: FilterKey) => (f[k] && appliesTo(k, tab) ? f[k] : '');
  const add = (key: KeyedPred['key'], test: Pred) => out.push({ key, test });

  if (view) {
    add(
      'view',
      (it) =>
        (!view.groups || (it.group !== null && view.groups.includes(it.group))) &&
        (!view.test || view.test(it, ctx)),
    );
  }
  // Semester: the address, else the view's, else the current one (HMP tabs) / all (past tab).
  const term = v('term') || (view ? view.term : tab === 'past' ? 'all' : 'current');
  const wanted = term === 'current' ? ctx.currentTerm : term === 'all' ? null : term;
  if (wanted) add('term', (it) => it.termKey === wanted);

  // Status: picked by hand; otherwise everything except the hidden-by-default groups (decision
  // D2), unless the view asks for one of them.
  const status = v('status');
  if (status) add('status', (it) => it.group === status);
  else if (!view?.groups?.some((g) => HIDDEN_GROUPS.includes(g)))
    add('status', (it) => !it.group || !HIDDEN_GROUPS.includes(it.group));

  if (v('q')) add('q', (it) => matchesSearch(it, f.q));
  if (v('programme'))
    add(
      'programme',
      (it) => it.programmeCode === f.programme || it.programmes.includes(f.programme),
    );
  if (v('discipline')) add('discipline', (it) => it.discipline === f.discipline);
  if (v('faculty')) add('faculty', (it) => it.facultyIds.includes(f.faculty));
  if (v('sme')) add('sme', (it) => it.smeId === f.sme);
  if (v('by')) add('by', (it) => it.allocatedById === f.by);

  if (v('due')) {
    const days = f.due === '7d' ? 7 : 30;
    add('due', (it) => {
      if (!it.dueAt) return false;
      const t = it.dueAt.getTime();
      return f.due === 'overdue' ? t < now : t >= now && t <= now + days * DAY;
    });
  }
  if (v('dueFrom') || v('dueTo'))
    add('dueFrom', (it) => inRange(it.dueAt, v('dueFrom'), v('dueTo')));

  if (v('updated')) {
    const since =
      f.updated === 'today' ? istTodayStart(ctx.now) : now - (f.updated === '7d' ? 7 : 30) * DAY;
    add('updated', (it) => it.kind !== 'not-started' && it.updatedAt.getTime() >= since);
  }
  if (v('updatedFrom') || v('updatedTo'))
    add(
      'updatedFrom',
      (it) => it.kind !== 'not-started' && inRange(it.updatedAt, v('updatedFrom'), v('updatedTo')),
    );

  if (v('published')) {
    const since = now - Number(f.published.replace('d', '')) * DAY;
    add('published', (it) => !!it.publishedAt && it.publishedAt.getTime() >= since);
  }
  if (v('publishedFrom') || v('publishedTo'))
    add('publishedFrom', (it) => inRange(it.publishedAt, v('publishedFrom'), v('publishedTo')));

  if (v('slot')) add('slot', (it) => it.schedule.some((s) => String(s.slot) === f.slot));
  if (v('day')) add('day', (it) => it.schedule.some((s) => s.day === f.day));
  if (v('session')) add('session', (it) => it.schedule.some((s) => s.session === f.session));
  if (v('ctype')) add('ctype', (it) => it.schedule.some((s) => s.type === f.ctype));
  if (v('sched')) add('sched', (it) => it.schedule.length > 0 === (f.sched === 'yes'));
  if (v('taxila')) add('taxila', (it) => it.taxila === f.taxila);
  if (v('sentback')) add('sentback', (it) => it.sentBack >= Number(f.sentback));
  if (v('changed')) add('changed', (it) => (it.changeSize ?? null) === f.changed);
  return out;
}

export function applyPreds(
  items: LibraryItem[],
  preds: KeyedPred[],
  skip: string[] = [],
): LibraryItem[] {
  const active = preds.filter((p) => !skip.includes(p.key));
  return items.filter((it) => active.every((p) => p.test(it)));
}

// ── Grouping, sorting, counting ──────────────────────────────────────────────

function compareItems(sort: SortKey, dir: 'asc' | 'desc') {
  const sign = dir === 'asc' ? 1 : -1;
  return (x: LibraryItem, y: LibraryItem): number => {
    let d = 0;
    if (sort === 'updated') d = x.updatedAt.getTime() - y.updatedAt.getTime();
    else if (sort === 'due') {
      // Items without a due date go last whichever way the list is sorted.
      if (!x.dueAt || !y.dueAt) {
        if (x.dueAt || y.dueAt) return x.dueAt ? -1 : 1;
      } else d = x.dueAt.getTime() - y.dueAt.getTime();
    } else if (sort === 'code') d = x.courseCode.localeCompare(y.courseCode);
    else if (sort === 'status')
      d = GROUP_ORDER.indexOf(x.group ?? 'published') - GROUP_ORDER.indexOf(y.group ?? 'published');
    else d = termRank(x.termKey) - termRank(y.termKey);
    return d * sign || y.updatedAt.getTime() - x.updatedAt.getTime();
  };
}

const sortDir = (sort: SortKey, dir?: '' | 'asc' | 'desc') =>
  dir || SORTS.find((s) => s.key === sort)!.dir;

export function sortItems(
  items: LibraryItem[],
  sort: SortKey = 'updated',
  dir?: '' | 'asc' | 'desc',
) {
  return [...items].sort(compareItems(sort, sortDir(sort, dir)));
}

/** One row per course: its most recently updated handout + how many others the list holds. */
export function groupByCourse(
  items: LibraryItem[],
  sort: SortKey = 'updated',
  dir?: '' | 'asc' | 'desc',
): LibraryGroup[] {
  const by = new Map<string, LibraryItem[]>();
  for (const it of items) by.set(it.courseKey, [...(by.get(it.courseKey) ?? []), it]);
  const cmp = compareItems(sort, sortDir(sort, dir));
  return [...by.values()]
    .map((list) => {
      const sorted = [...list].sort((x, y) => y.updatedAt.getTime() - x.updatedAt.getTime());
      return { latest: sorted[0]!, olderCount: sorted.length - 1 };
    })
    .sort((x, y) => cmp(x.latest, y.latest));
}

/** Courses per value (an item counts once per distinct value it carries). */
export function countCourses(
  items: LibraryItem[],
  key: (it: LibraryItem) => (string | null)[],
): Map<string, number> {
  const sets = new Map<string, Set<string>>();
  for (const it of items) {
    for (const k of new Set(key(it))) {
      if (!k) continue;
      if (!sets.has(k)) sets.set(k, new Set());
      sets.get(k)!.add(it.courseKey);
    }
  }
  return new Map([...sets].map(([k, s]) => [k, s.size]));
}

export const courseCount = (items: LibraryItem[]) => new Set(items.map((i) => i.courseKey)).size;

// ── Loading ──────────────────────────────────────────────────────────────────

type ScopeUser = Pick<SessionUser, 'id' | 'roles'>;

const PUBLISHED_LOG = ['success', 'EXPORTED', 'MANUALLY_CONFIRMED'];
const disciplineOf = (code: string) => /^([A-Z]+) /.exec(code)?.[1] ?? null;
const scheduleKey = (term: string | null, code: string) => `${term}|${code}`;

export interface ScheduledCourse {
  term: string;
  code: string;
  /** The Dibba's title (often in capitals). */
  title: string;
  /** The course catalogue's title, when the code is in the catalogue. */
  catalogueTitle: string | null;
  programmes: Set<string>;
  at: Date;
  slots: ScheduleSlot[];
  /** "TITLE|slot|day|session" for each taught slot — cross-listed codes share one. */
  links: Set<string>;
}

const linkKey = (title: string, s: Pick<ScheduleSlot, 'slot' | 'day' | 'session'>) =>
  `${title.trim().replace(/\s+/g, ' ').toUpperCase()}|${s.slot}|${s.day}|${s.session}`;

/** The published Course Dibba schedules, by term × course code. */
async function loadSchedule(): Promise<Map<string, ScheduledCourse>> {
  const entries = await prisma.dibbaEntry.findMany({
    where: { import: { status: 'PUBLISHED' }, courseType: { not: DibbaCourseType.NOT_OFFERED } },
    select: {
      courseCode: true,
      courseTitle: true,
      programmeCode: true,
      slotNo: true,
      slotDay: true,
      slotSession: true,
      courseType: true,
      course: { select: { bitsCourseNumber: true, title: true } },
      import: {
        select: {
          publishedAt: true,
          createdAt: true,
          term: { select: { year: true, term: true } },
        },
      },
    },
  });
  const courses = new Map<string, ScheduledCourse>();
  for (const e of entries) {
    const term = termKey(e.import.term.year, e.import.term.term);
    const code = e.course?.bitsCourseNumber ?? e.courseCode;
    const k = scheduleKey(term, code);
    const c = courses.get(k) ?? {
      term,
      code,
      title: e.courseTitle,
      catalogueTitle: e.course?.title ?? null,
      programmes: new Set<string>(),
      at: e.import.publishedAt ?? e.import.createdAt,
      slots: [],
      links: new Set<string>(),
    };
    c.programmes.add(e.programmeCode);
    const slot = { slot: e.slotNo, day: e.slotDay, session: e.slotSession, type: e.courseType };
    if (!c.slots.some((s) => s.slot === e.slotNo && s.type === e.courseType)) c.slots.push(slot);
    // Projects and dissertations share titles ("PROJECT") without being one class.
    if (e.courseType !== DibbaCourseType.PROJECT && e.slotNo > 0)
      c.links.add(linkKey(e.courseTitle, slot));
    courses.set(k, c);
  }
  return courses;
}

async function loadHmpItems(
  user: ScopeUser,
  tab: LibraryTab,
  schedule: Map<string, ScheduledCourse>,
): Promise<LibraryItem[]> {
  const isSme = user.roles.includes(RoleName.SME);
  const [cfg, rows] = await Promise.all([
    loadWorkflowConfig(),
    prisma.handoutRequest.findMany({
      where: libraryScope(user, tab),
      select: {
        id: true,
        refNo: true,
        status: true,
        updatedAt: true,
        offering: {
          select: {
            course: { select: { bitsCourseNumber: true, alternateCodes: true, title: true } },
            semester: {
              select: { name: true, year: true, term: true, programme: { select: { code: true } } },
            },
          },
        },
        assignments: {
          where: { active: true },
          select: { faculty: { select: { id: true, name: true } } },
        },
        smeAssignment: {
          select: {
            smeUser: { select: { id: true, name: true } },
            assignedBy: { select: { id: true, name: true } },
          },
        },
        handout: {
          select: {
            publishLogs: {
              where: { status: { in: PUBLISHED_LOG } },
              select: { status: true, publishedAt: true },
              orderBy: { publishedAt: 'asc' },
            },
          },
        },
        approvals: {
          where: isSme
            ? { OR: [{ decision: 'REWORK' }, { stage: 'SME_REVIEW', reviewerId: user.id }] }
            : { decision: 'REWORK' },
          select: { decision: true, stage: true, reviewerId: true },
        },
      },
    }),
  ]);
  return rows.map((r): LibraryItem => {
    const c = r.offering.course;
    const sem = r.offering.semester;
    const tk = termKey(sem.year, sem.term);
    const logs = r.handout?.publishLogs ?? [];
    const published = r.status === S.PUBLISHED || logs.length > 0;
    const sla = slaHoursFor(cfg, r.status);
    const codes = [c.bitsCourseNumber, ...c.alternateCodes];
    return {
      kind: 'hmp',
      id: r.id,
      courseKey: c.bitsCourseNumber,
      courseCode: c.bitsCourseNumber,
      codes,
      courseTitle: displayCourseTitle(c.title),
      refNo: r.refNo,
      status: r.status,
      group: statusGroupOf(r.status, published),
      termKey: tk,
      semesterName: sem.name,
      programmeCode: sem.programme.code,
      programmes: [],
      discipline: disciplineOf(c.bitsCourseNumber),
      faculty: r.assignments.map((a) => a.faculty.name),
      facultyIds: r.assignments.map((a) => a.faculty.id),
      sme: r.smeAssignment?.smeUser.name ?? null,
      smeId: r.smeAssignment?.smeUser.id ?? null,
      allocatedBy: r.smeAssignment?.assignedBy.name ?? null,
      allocatedById: r.smeAssignment?.assignedBy.id ?? null,
      updatedAt: r.updatedAt,
      dueAt: sla == null ? null : new Date(r.updatedAt.getTime() + sla * 3_600_000),
      publishedAt: published ? (logs[0]?.publishedAt ?? r.updatedAt) : null,
      taxila:
        tab !== 'published'
          ? null
          : logs.some((l) => l.status !== 'EXPORTED')
            ? 'sent'
            : logs.length > 0
              ? 'export'
              : 'none',
      sentBack: r.approvals.filter((a) => a.decision === 'REWORK').length,
      mine:
        r.assignments.some((a) => a.faculty.id === user.id) ||
        r.smeAssignment?.smeUser.id === user.id,
      reviewedByMe: r.approvals.some(
        (a) => a.stage === 'SME_REVIEW' && a.reviewerId === user.id && a.decision !== 'PENDING',
      ),
      schedule: codes.flatMap((code) => schedule.get(scheduleKey(tk, code))?.slots ?? []),
    };
  });
}

/**
 * Cross-listed codes, grouped: codes with the same title in the same slot of one semester's Dibba
 * are one class ("ET ZC232 / ENGG ZC232"). Catalogue codes lead, then alphabetical.
 */
export function crossListedGroups(schedule: Map<string, ScheduledCourse>): ScheduledCourse[][] {
  const parent = new Map<string, string>([...schedule.keys()].map((k) => [k, k]));
  const root = (k: string): string => {
    while (parent.get(k) !== k) k = parent.get(k)!;
    return k;
  };
  const owner = new Map<string, string>();
  for (const [k, c] of schedule) {
    for (const l of c.links) {
      const o = owner.get(`${c.term}|${l}`);
      if (o) parent.set(root(k), root(o));
      else owner.set(`${c.term}|${l}`, k);
    }
  }
  const groups = new Map<string, ScheduledCourse[]>();
  for (const [k, c] of schedule) groups.set(root(k), [...(groups.get(root(k)) ?? []), c]);
  return [...groups.values()].map((g) =>
    g.sort(
      (a, b) =>
        Number(!a.catalogueTitle) - Number(!b.catalogueTitle) || a.code.localeCompare(b.code),
    ),
  );
}

/**
 * Courses in a published Course Dibba with no HMP request in that semester (oversight only),
 * one row per class: a request for any cross-listed code covers the group.
 */
export function notStartedItems(
  schedule: Map<string, ScheduledCourse>,
  hmp: LibraryItem[],
  names: Map<string, string>,
): LibraryItem[] {
  const started = new Set(hmp.flatMap((it) => it.codes.map((c) => scheduleKey(it.termKey, c))));
  const out: LibraryItem[] = [];
  for (const group of crossListedGroups(schedule)) {
    if (group.some((g) => started.has(scheduleKey(g.term, g.code)))) continue;
    const c = group[0]!;
    const slots: ScheduleSlot[] = [];
    for (const s of group.flatMap((g) => g.slots)) {
      if (!slots.some((x) => x.slot === s.slot && x.type === s.type)) slots.push(s);
    }
    out.push({
      kind: 'not-started',
      id: `${c.term}:${c.code}`,
      courseKey: c.code,
      courseCode: c.code,
      codes: group.map((g) => g.code),
      courseTitle: displayCourseTitle(c.title, group.find((g) => g.catalogueTitle)?.catalogueTitle),
      refNo: null,
      status: null,
      group: 'not-started',
      termKey: c.term,
      semesterName: names.get(c.term) ?? termLabel(c.term),
      programmeCode: null,
      programmes: [...new Set(group.flatMap((g) => [...g.programmes]))].sort(),
      discipline: disciplineOf(c.code),
      faculty: [],
      facultyIds: [],
      sme: null,
      smeId: null,
      allocatedBy: null,
      allocatedById: null,
      // Only a sort key: nothing has happened yet, so the list shows “—” for Updated and Due.
      updatedAt: c.at,
      dueAt: null,
      publishedAt: null,
      taxila: null,
      sentBack: 0,
      mine: false,
      reviewedByMe: false,
      schedule: slots,
    });
  }
  return out;
}

/** Past BITS handouts: approvedForReuse AND data IS NOT NULL (PAST_HANDOUT_SCOPE, in SQL). */
async function loadPastItems(): Promise<LibraryItem[]> {
  // Title / instructor / semester live inside the stored handout; read just those paths.
  const rows = await prisma.$queryRaw<
    {
      id: string;
      code: string | null;
      alt: string[] | null;
      title: string | null;
      sem: string | null;
      inst: string | null;
      at: Date;
    }[]
  >(Prisma.sql`
    SELECT id, "bitsCourseNumber" AS code, "alternateCodes" AS alt,
           data->'partA'->>'courseTitle' AS title,
           data->'metadata'->>'semester' AS sem,
           data->'partA'->'instructors'->>0 AS inst,
           COALESCE("approvedAt", "importedAt") AS at
    FROM "HandoutImport"
    WHERE "approvedForReuse" = true AND data IS NOT NULL AND data <> 'null'::jsonb`);
  return rows.map(
    (r): LibraryItem => ({
      kind: 'past',
      id: r.id,
      courseKey: r.code ?? `past:${r.id}`,
      courseCode: r.code ?? '—',
      codes: [r.code ?? '—', ...(r.alt ?? [])],
      courseTitle: r.title ? displayCourseTitle(r.title) : 'Untitled handout',
      refNo: null,
      status: null,
      group: null,
      termKey: termKeyFromText(r.sem),
      semesterName: r.sem ?? '',
      programmeCode: null,
      programmes: [],
      discipline: r.code ? disciplineOf(r.code) : null,
      faculty: r.inst ? [r.inst] : [],
      facultyIds: [],
      sme: null,
      smeId: null,
      allocatedBy: null,
      allocatedById: null,
      updatedAt: r.at,
      dueAt: null,
      publishedAt: null,
      taxila: null,
      sentBack: 0,
      mine: false,
      reviewedByMe: false,
      schedule: [],
    }),
  );
}

/** Every row the user may see, per tab — the one load behind lists, counts, export, suggestions. */
export async function loadAllItems(
  user: ScopeUser,
  names?: Map<string, string>,
): Promise<Record<Tab, LibraryItem[]>> {
  const [schedule, termNameMap] = await Promise.all([
    loadSchedule(),
    names ? Promise.resolve(names) : termNames(),
  ]);
  const [published, inProgress, past] = await Promise.all([
    loadHmpItems(user, 'published', schedule),
    loadHmpItems(user, 'in-progress', schedule),
    loadPastItems(),
  ]);
  const notStarted = seesAllWork(user)
    ? notStartedItems(schedule, [...published, ...inProgress], termNameMap)
    : [];
  return { published, 'in-progress': [...inProgress, ...notStarted], past };
}

/** Course codes the user teaches or reviews (any status) — for "last year's handout". */
async function myCourseCodes(user: ScopeUser): Promise<Set<string>> {
  if (!user.roles.includes(RoleName.FACULTY) && !user.roles.includes(RoleName.SME))
    return new Set();
  const rows = await prisma.course.findMany({
    where: {
      offerings: {
        some: {
          requests: {
            some: {
              OR: [
                { assignments: { some: { facultyId: user.id, active: true } } },
                { smeAssignment: { is: { smeUserId: user.id } } },
              ],
            },
          },
        },
      },
    },
    select: { bitsCourseNumber: true, alternateCodes: true },
  });
  return new Set(rows.flatMap((r) => [r.bitsCourseNumber, ...r.alternateCodes]));
}

// ── The page ─────────────────────────────────────────────────────────────────

export interface Facet {
  value: string;
  label: string;
  /** null = not counted (the change size is only worked out when asked for). */
  count: number | null;
  dot?: string;
}

export interface ViewChip {
  key: string;
  label: string;
  count: number | null;
  active: boolean;
  href: string;
  external: boolean;
}

export interface LibraryPage {
  filter: LibraryFilter;
  view: QuickView | undefined;
  currentTerm: string | null;
  currentTermName: string | null;
  /** The semester the list shows: 'current' | 'all' | a term key. */
  effectiveTerm: string;
  tabs: { tab: Tab; count: number; href: string }[];
  views: ViewChip[];
  groups: LibraryGroup[];
  /** Every handout in the filtered list (sorted) — the Excel export. */
  items: LibraryItem[];
  totalGroups: number;
  totalItems: number;
  /** "Changed vs last year" sizes were worked out for this list. */
  changeComputed: boolean;
  facets: Partial<Record<FilterKey, Facet[]>>;
  termName: (k: string) => string;
}

export interface LoadOptions {
  now?: Date;
  /** Fills `changeSize` on items (decision D4: only when a view or filter needs it). */
  attachChangeSizes?: (items: LibraryItem[]) => Promise<void>;
  /** Count for the Admin "Past BITS handouts awaiting approval" link. */
  corpusAwaiting?: () => Promise<number>;
}

export const PRESET_OPTIONS: Partial<Record<FilterKey, { value: string; label: string }[]>> = {
  due: [
    { value: 'overdue', label: 'Overdue' },
    { value: '7d', label: 'Due in the next 7 days' },
    { value: '30d', label: 'Due in the next 30 days' },
  ],
  updated: [
    { value: 'today', label: 'Today' },
    { value: '7d', label: 'Last 7 days' },
    { value: '30d', label: 'Last 30 days' },
  ],
  published: [
    { value: '7d', label: 'Last 7 days' },
    { value: '30d', label: 'Last 30 days' },
    { value: '90d', label: 'Last 90 days' },
  ],
  sched: [
    { value: 'yes', label: 'In the published schedule' },
    { value: 'no', label: 'Not in the schedule' },
  ],
  taxila: [
    { value: 'sent', label: 'Yes — on Taxila' },
    { value: 'export', label: 'Export downloaded only' },
    { value: 'none', label: 'Not yet' },
  ],
  sentback: [
    { value: '1', label: 'At least once' },
    { value: '2', label: 'At least twice' },
    { value: '3', label: '3 times or more' },
  ],
  changed: [
    { value: 'large', label: 'Changed a lot' },
    { value: 'medium', label: 'Some changes' },
    { value: 'small', label: 'Small changes' },
    { value: 'none', label: 'No changes' },
  ],
};

const DAY_LABEL: Record<string, string> = { SAT: 'Saturday', SUN: 'Sunday', FRI: 'Friday' };
const SESSION_LABEL: Record<string, string> = { FN: 'Forenoon', AN: 'Afternoon', EV: 'Evening' };
const CTYPE_LABEL: Record<string, string> = {
  CORE: 'Core',
  ELECTIVE: 'Elective',
  PROJECT: 'Project / dissertation',
  BACKLOG: 'Backlog',
  NOT_OFFERED: 'Not offered',
  UNSPECIFIED: 'Not stated',
};

export async function loadLibrary(
  user: ScopeUser,
  f: LibraryFilter,
  opts: LoadOptions = {},
): Promise<LibraryPage> {
  const now = opts.now ?? new Date();
  const names = await termNames();
  const [byTab, currentTerm, mine] = await Promise.all([
    loadAllItems(user, names),
    currentTermKey(now),
    myCourseCodes(user),
  ]);
  const ctx: ViewCtx = { now, userId: user.id, myCourseCodes: mine, currentTerm };
  const allViews = quickViews(user.roles);
  const view = allViews.find((v) => v.key === f.view && v.tab === f.tab && !v.href);
  const termName = (k: string) => names.get(k) ?? termLabel(k);

  // Decision D4: the change size is worked out only when this list needs it.
  const needsChange = !!view?.needsChange || (!!f.changed && appliesTo('changed', f.tab));
  if (needsChange && opts.attachChangeSizes) {
    await opts.attachChangeSizes(byTab[f.tab].filter((it) => it.kind === 'hmp'));
  }

  const listFor = (state: LibraryFilter, v: QuickView | undefined) =>
    applyPreds(byTab[state.tab], predicates(state, v, ctx));

  const preds = predicates(f, view, ctx);
  const visible = sortItems(applyPreds(byTab[f.tab], preds), f.sort, f.dir);
  const groups = groupByCourse(visible, f.sort, f.dir);

  // Tabs: the list a tab link opens — the search and filters, but never a quick view or a status
  // pick, so a tab's number stays put while the person moves between views. (Not-started courses
  // are hidden by default, so they count only inside their own quick view.)
  const tabs = TABS.map((t) => {
    const state: LibraryFilter = {
      ...f,
      ...EMPTY_FILTERS,
      ...carriedFilters(f, t),
      tab: t,
      view: '',
      page: 1,
    };
    return { tab: t, count: courseCount(listFor(state, undefined)), href: libraryHref(state) };
  });

  // Quick views: what each chip opens — same filters, its own semester and status.
  const corpusCount = allViews.some((v) => v.href) ? await opts.corpusAwaiting?.() : undefined;
  const views: ViewChip[] = allViews.map((v) => {
    if (v.href) {
      return {
        key: v.key,
        label: v.label,
        count: corpusCount ?? null,
        active: false,
        href: v.href,
        external: true,
      };
    }
    const state: LibraryFilter = {
      ...f,
      ...EMPTY_FILTERS,
      ...carriedFilters(f, v.tab),
      term: '',
      tab: v.tab,
      view: v.key,
      page: 1,
    };
    const countable = !v.needsChange || (needsChange && v.tab === f.tab);
    return {
      key: v.key,
      label: v.label,
      count: countable ? courseCount(listFor(state, v)) : null,
      active: view?.key === v.key,
      href: libraryHref(state),
      external: false,
    };
  });

  // Facets: each filter's options counted with every OTHER filter applied, inside the scope.
  const items = byTab[f.tab];
  const base = (skip: FilterKey[]) => applyPreds(items, preds, skip);
  const enumFacet = (
    k: FilterKey,
    key: (it: LibraryItem) => (string | null)[],
    label: (v: string) => string,
    order: (a: Facet, b: Facet) => number = (a, b) => a.label.localeCompare(b.label),
  ): Facet[] => {
    const counts = countCourses(base([k]), key);
    const exists = countCourses(items, key); // options in scope; zero-count ones are greyed
    return [...new Set([...exists.keys(), ...(f[k] ? [f[k]] : [])])]
      .map((value) => ({ value, label: label(value), count: counts.get(value) ?? 0 }))
      .sort(order);
  };
  const presetFacet = (k: FilterKey, skip: FilterKey[] = [k]): Facet[] => {
    const b = base(skip);
    return (PRESET_OPTIONS[k] ?? []).map((o) => {
      const p = predicates({ ...f, ...EMPTY_FILTERS, [k]: o.value }, undefined, ctx).find(
        (x) => x.key === k,
      );
      const counted = k !== 'changed' || needsChange;
      return { ...o, count: counted && p ? courseCount(b.filter(p.test)) : null };
    });
  };
  const nameMap = (pairs: (it: LibraryItem) => [string | null, string | null][]) => {
    const m = new Map<string, string>();
    for (const it of items) for (const [id, n] of pairs(it)) if (id && n) m.set(id, n);
    return m;
  };

  const facets: LibraryPage['facets'] = {
    term: enumFacet(
      'term',
      (it) => [it.termKey],
      termName,
      (a, b) => termRank(b.value) - termRank(a.value),
    ),
    programme: enumFacet(
      'programme',
      (it) => [it.programmeCode, ...it.programmes],
      (v) => v,
    ),
    discipline: enumFacet(
      'discipline',
      (it) => [it.discipline],
      (v) => v,
    ),
    status: enumFacet(
      'status',
      (it) => [it.group],
      (v) => groupMeta(v as StatusGroup).label,
      (a, b) =>
        GROUP_ORDER.indexOf(a.value as StatusGroup) - GROUP_ORDER.indexOf(b.value as StatusGroup),
    ).map((x) => ({ ...x, dot: groupMeta(x.value as StatusGroup).dot })),
    slot: enumFacet(
      'slot',
      (it) => it.schedule.map((s) => String(s.slot)),
      (v) => (v === '0' ? 'No slot (project)' : `Slot ${v}`),
      (a, b) => Number(a.value) - Number(b.value),
    ),
    day: enumFacet(
      'day',
      (it) => it.schedule.map((s) => s.day),
      (v) => DAY_LABEL[v] ?? v,
    ),
    session: enumFacet(
      'session',
      (it) => it.schedule.map((s) => s.session),
      (v) => SESSION_LABEL[v] ?? v,
    ),
    ctype: enumFacet(
      'ctype',
      (it) => it.schedule.map((s) => s.type),
      (v) => CTYPE_LABEL[v] ?? v,
    ),
    due: presetFacet('due', ['due', 'dueFrom']),
    updated: presetFacet('updated', ['updated', 'updatedFrom']),
    published: presetFacet('published', ['published', 'publishedFrom']),
    sched: presetFacet('sched'),
    taxila: presetFacet('taxila'),
    sentback: presetFacet('sentback'),
    changed: presetFacet('changed'),
  };
  if (seesAllWork(user)) {
    const fac = nameMap((it) => it.facultyIds.map((id, i) => [id, it.faculty[i] ?? null]));
    const sme = nameMap((it) => [[it.smeId, it.sme]]);
    const by = nameMap((it) => [[it.allocatedById, it.allocatedBy]]);
    facets.faculty = enumFacet(
      'faculty',
      (it) => it.facultyIds,
      (v) => fac.get(v) ?? '—',
    );
    facets.sme = enumFacet(
      'sme',
      (it) => [it.smeId],
      (v) => sme.get(v) ?? '—',
    );
    facets.by = enumFacet(
      'by',
      (it) => [it.allocatedById],
      (v) => by.get(v) ?? '—',
    );
  }

  return {
    filter: f,
    view,
    currentTerm,
    currentTermName: currentTerm ? termName(currentTerm) : null,
    effectiveTerm: f.term || (view ? view.term : f.tab === 'past' ? 'all' : 'current'),
    tabs,
    views,
    groups: groups.slice((f.page - 1) * PAGE_SIZE, f.page * PAGE_SIZE),
    items: visible,
    totalGroups: groups.length,
    totalItems: visible.length,
    changeComputed: needsChange,
    facets,
    termName,
  };
}

/** Plain-words label for an active-filter chip. */
export function filterChipLabel(
  k: FilterKey,
  value: string,
  page: Pick<LibraryPage, 'facets' | 'currentTermName' | 'termName'>,
): string {
  const fromFacet = page.facets[k]?.find((o) => o.value === value)?.label;
  const preset = PRESET_OPTIONS[k]?.find((o) => o.value === value)?.label;
  switch (k) {
    case 'q':
      return `Search: “${value}”`;
    case 'term':
      if (value === 'all') return 'All semesters';
      if (value === 'current')
        return `Current semester${page.currentTermName ? ` (${page.currentTermName})` : ''}`;
      return page.termName(value);
    case 'status':
      return groupMeta(value as StatusGroup).label;
    case 'programme':
      return `Programme: ${value}`;
    case 'discipline':
      return `Discipline: ${value}`;
    case 'faculty':
      return `Faculty: ${fromFacet ?? '—'}`;
    case 'sme':
      return `Subject expert: ${fromFacet ?? '—'}`;
    case 'by':
      return `Allocated by: ${fromFacet ?? '—'}`;
    case 'due':
    case 'sched':
      return preset ?? value;
    case 'updated':
      return `Updated: ${preset ?? value}`;
    case 'published':
      return `Published: ${preset ?? value}`;
    case 'taxila':
      return `On Taxila: ${preset ?? value}`;
    case 'sentback':
      return `Sent back ${(preset ?? value).toLowerCase()}`;
    case 'changed':
      return `Since last year: ${preset ?? value}`;
    case 'dueFrom':
      return `Due from ${formatDate(value)}`;
    case 'dueTo':
      return `Due by ${formatDate(value)}`;
    case 'updatedFrom':
      return `Updated from ${formatDate(value)}`;
    case 'updatedTo':
      return `Updated by ${formatDate(value)}`;
    case 'publishedFrom':
      return `Published from ${formatDate(value)}`;
    case 'publishedTo':
      return `Published by ${formatDate(value)}`;
    default:
      return fromFacet ?? value;
  }
}

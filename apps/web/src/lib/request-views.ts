import { HandoutStatus, type Prisma } from '@hmp/db';

/**
 * One definition of every role's request list and its named "views" (the
 * slices a dashboard card counts). The dashboard card and the list it links to
 * both build their query from here, so the number on a card always equals the
 * number of rows behind its link.
 *
 *   list   /ic/requests, /hog/requests, /pc/requests, /faculty/assignments,
 *          /sme/review
 *   view   ?view=<key>     a named slice (what a card links to)
 *   status ?status=<value> one status, picked in the list's filter
 *
 * Anything in the address that isn't valid for the role is ignored (the list
 * shows everything and says so) — it can neither crash the page nor widen
 * the role's scope.
 */

export type ListRole = 'IC' | 'HOG' | 'PC' | 'FACULTY' | 'SME';

export interface RequestView {
  key: string;
  /** Shown above the list when the view is active. */
  label: string;
  statuses: HandoutStatus[];
  /** Extra condition on top of the statuses (e.g. faculty "not yet accepted"). */
  extra?: (userId: string) => Prisma.HandoutRequestWhereInput;
}

const S = HandoutStatus;

/** Statuses each role's list can show ("All" in its filter). */
export const LIST_STATUSES: Record<ListRole, HandoutStatus[]> = {
  IC: Object.values(HandoutStatus),
  HOG: [
    S.REQUESTED,
    S.ALLOCATED,
    S.ASSIGNED,
    S.IN_PROGRESS,
    S.SME_REVIEW,
    S.SUBMITTED,
    S.UNDER_REVIEW,
    S.REWORK_REQUESTED,
    S.APPROVED,
    S.PUBLISHED,
  ],
  PC: [
    S.ALLOCATED,
    S.ASSIGNED,
    S.IN_PROGRESS,
    S.SME_REVIEW,
    S.SUBMITTED,
    S.UNDER_REVIEW,
    S.REWORK_REQUESTED,
    S.APPROVED,
    S.PUBLISHED,
  ],
  FACULTY: [
    S.ASSIGNED,
    S.IN_PROGRESS,
    S.SME_REVIEW,
    S.SUBMITTED,
    S.UNDER_REVIEW,
    S.REWORK_REQUESTED,
    S.APPROVED,
    S.PUBLISHED,
  ],
  SME: Object.values(HandoutStatus),
};

export const LIST_PATH: Record<ListRole, string> = {
  IC: '/ic/requests',
  HOG: '/hog/requests',
  PC: '/pc/requests',
  FACULTY: '/faculty/assignments',
  SME: '/sme/review',
};

export const VIEWS: Record<ListRole, RequestView[]> = {
  IC: [
    {
      key: 'not-submitted',
      label: 'Not yet submitted by faculty',
      statuses: [S.REQUESTED, S.ALLOCATED, S.ASSIGNED, S.IN_PROGRESS],
    },
    { key: 'ready-to-publish', label: 'Ready to publish', statuses: [S.APPROVED] },
    { key: 'returned', label: 'Returned to faculty', statuses: [S.REWORK_REQUESTED] },
  ],
  HOG: [
    { key: 'pending-allocation', label: 'Waiting for allocation', statuses: [S.REQUESTED] },
    { key: 'final-approval', label: 'Waiting for your final approval', statuses: [S.UNDER_REVIEW] },
    {
      key: 'in-progress',
      label: 'In progress with PC, faculty or SME',
      statuses: [
        S.ALLOCATED,
        S.ASSIGNED,
        S.IN_PROGRESS,
        S.SME_REVIEW,
        S.SUBMITTED,
        S.REWORK_REQUESTED,
      ],
    },
    { key: 'approved', label: 'Approved or published', statuses: [S.APPROVED, S.PUBLISHED] },
  ],
  PC: [
    { key: 'awaiting-confirmation', label: 'Allocations to confirm', statuses: [S.ALLOCATED] },
    { key: 'awaiting-review', label: 'Handouts to review', statuses: [S.SUBMITTED] },
    {
      key: 'in-progress',
      label: 'With faculty or SME',
      statuses: [S.ASSIGNED, S.IN_PROGRESS, S.SME_REVIEW, S.REWORK_REQUESTED],
    },
    {
      key: 'forwarded',
      label: 'Forwarded to HOG or done',
      statuses: [S.UNDER_REVIEW, S.APPROVED, S.PUBLISHED],
    },
  ],
  FACULTY: [
    {
      key: 'to-accept',
      label: 'Waiting for you to accept',
      statuses: [S.ASSIGNED],
      extra: (userId) => ({
        assignments: { some: { facultyId: userId, active: true, acceptedAt: null } },
      }),
    },
    {
      key: 'in-progress',
      label: 'Being written or revised',
      statuses: [S.ASSIGNED, S.IN_PROGRESS, S.REWORK_REQUESTED],
      extra: (userId) => ({
        assignments: { some: { facultyId: userId, active: true, acceptedAt: { not: null } } },
      }),
    },
    {
      key: 'with-reviewers',
      label: 'With reviewers',
      statuses: [S.SME_REVIEW, S.SUBMITTED, S.UNDER_REVIEW],
    },
    { key: 'done', label: 'Approved or published', statuses: [S.APPROVED, S.PUBLISHED] },
  ],
  SME: [
    { key: 'awaiting', label: 'Waiting for your review', statuses: [S.SME_REVIEW] },
    {
      key: 'assigned',
      label: 'All handouts assigned to you',
      statuses: Object.values(HandoutStatus),
    },
  ],
};

/** The view a list opens with when the address has no filter. */
const DEFAULT_VIEW: Partial<Record<ListRole, string>> = { SME: 'awaiting' };

export function getView(role: ListRole, key: string): RequestView {
  const view = VIEWS[role].find((v) => v.key === key);
  if (!view) throw new Error(`Unknown ${role} view "${key}"`);
  return view;
}

export function viewHref(role: ListRole, key: string): string {
  getView(role, key); // fail loudly on a typo in a dashboard
  return `${LIST_PATH[role]}?view=${key}`;
}

export interface ListFilter {
  view: RequestView | null;
  status: HandoutStatus | null;
  /** True when the address carried a filter that isn't valid for this role. */
  ignored: boolean;
}

type Param = string | string[] | undefined;
const first = (p: Param) => (Array.isArray(p) ? p[0] : p) || undefined;

export function parseListFilter(
  role: ListRole,
  params: { view?: Param; status?: Param } | undefined,
): ListFilter {
  const viewKey = first(params?.view);
  const statusRaw = first(params?.status);
  let ignored = false;

  let view: RequestView | null = null;
  if (viewKey) {
    view = VIEWS[role].find((v) => v.key === viewKey) ?? null;
    if (!view) ignored = true;
  }

  let status: HandoutStatus | null = null;
  if (statusRaw) {
    if ((LIST_STATUSES[role] as string[]).includes(statusRaw)) {
      status = statusRaw as HandoutStatus;
    } else {
      ignored = true;
    }
  }

  if (ignored) return { view: null, status: null, ignored: true };
  if (!view && !status && DEFAULT_VIEW[role]) {
    view = getView(role, DEFAULT_VIEW[role]!);
  }
  return { view, status, ignored: false };
}

function scopeWhere(role: ListRole, userId: string): Prisma.HandoutRequestWhereInput {
  if (role === 'FACULTY') return { assignments: { some: { facultyId: userId, active: true } } };
  if (role === 'SME') return { smeAssignment: { smeUserId: userId } };
  return {};
}

/** The Prisma `where` for a role's list under a filter. */
export function listWhere(
  role: ListRole,
  userId: string,
  filter: ListFilter,
): Prisma.HandoutRequestWhereInput {
  let statuses = filter.view ? filter.view.statuses : LIST_STATUSES[role];
  if (filter.status) statuses = statuses.includes(filter.status) ? [filter.status] : [];
  // Never wider than the role's own list.
  statuses = statuses.filter((s) => LIST_STATUSES[role].includes(s));
  const and: Prisma.HandoutRequestWhereInput[] = [
    scopeWhere(role, userId),
    { status: { in: statuses } },
  ];
  if (filter.view?.extra) and.push(filter.view.extra(userId));
  return { AND: and };
}

/** The `where` a dashboard card counts — identical to its list's. */
export function viewWhere(
  role: ListRole,
  userId: string,
  key: string,
): Prisma.HandoutRequestWhereInput {
  return listWhere(role, userId, { view: getView(role, key), status: null, ignored: false });
}

/** Keeps the active filter when paging. */
export function filterQuery(filter: ListFilter, page?: number): string {
  const q = new URLSearchParams();
  if (filter.view) q.set('view', filter.view.key);
  if (filter.status) q.set('status', filter.status);
  if (page && page > 1) q.set('page', String(page));
  const s = q.toString();
  return s ? `?${s}` : '';
}

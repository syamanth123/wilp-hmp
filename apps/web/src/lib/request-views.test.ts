import { describe, expect, it } from 'vitest';
import { HandoutStatus } from '@hmp/db';
import {
  LIST_STATUSES,
  VIEWS,
  filterQuery,
  listWhere,
  parseListFilter,
  viewHref,
  viewWhere,
} from './request-views';

const statusesOf = (where: ReturnType<typeof listWhere>) => {
  const and = (where.AND ?? []) as Array<Record<string, unknown>>;
  const clause = and.find((c) => 'status' in c) as { status: { in: HandoutStatus[] } };
  return clause.status.in;
};

describe('parseListFilter', () => {
  it('accepts a known view and a status the role can see', () => {
    expect(parseListFilter('HOG', { view: 'final-approval' }).view?.key).toBe('final-approval');
    expect(parseListFilter('PC', { status: 'SUBMITTED' }).status).toBe('SUBMITTED');
  });

  it('ignores an unknown status instead of crashing, and says so', () => {
    const f = parseListFilter('IC', { status: 'NOT_A_STATUS' });
    expect(f).toEqual({ view: null, status: null, ignored: true });
  });

  it("ignores a status outside the role's list (no widening of scope)", () => {
    expect(parseListFilter('PC', { status: 'REQUESTED' }).ignored).toBe(true);
    expect(parseListFilter('FACULTY', { status: 'DRAFT' }).ignored).toBe(true);
  });

  it('ignores an unknown view', () => {
    expect(parseListFilter('HOG', { view: 'everything' }).ignored).toBe(true);
  });

  it('takes the first value when a parameter repeats', () => {
    expect(parseListFilter('PC', { status: ['SUBMITTED', 'X'] }).status).toBe('SUBMITTED');
  });

  it('opens the SME list on "waiting for your review" by default', () => {
    expect(parseListFilter('SME', {}).view?.key).toBe('awaiting');
  });
});

describe('listWhere / viewWhere', () => {
  it('shows SME review in every list that covers it', () => {
    for (const role of ['HOG', 'PC', 'FACULTY', 'IC'] as const) {
      expect(LIST_STATUSES[role]).toContain(HandoutStatus.SME_REVIEW);
    }
  });

  it('scopes faculty to their own active assignments', () => {
    const where = listWhere('FACULTY', 'fac-1', parseListFilter('FACULTY', {}));
    expect(where.AND).toContainEqual({
      assignments: { some: { facultyId: 'fac-1', active: true } },
    });
  });

  it('scopes SMEs to handouts assigned to them', () => {
    const where = listWhere('SME', 'sme-1', parseListFilter('SME', { view: 'assigned' }));
    expect(where.AND).toContainEqual({ smeAssignment: { smeUserId: 'sme-1' } });
  });

  it('a status picked inside a view narrows the view, never widens it', () => {
    const f = parseListFilter('HOG', { view: 'final-approval', status: 'REQUESTED' });
    expect(statusesOf(listWhere('HOG', '', f))).toEqual([]);
  });

  it('a card counts exactly the query its list runs', () => {
    for (const [role, views] of Object.entries(VIEWS) as [keyof typeof VIEWS, typeof VIEWS.IC][]) {
      for (const v of views) {
        const fromList = listWhere(role, 'u1', parseListFilter(role, { view: v.key }));
        expect(viewWhere(role, 'u1', v.key)).toEqual(fromList);
        expect(viewHref(role, v.key)).toContain(`view=${v.key}`);
      }
    }
  });

  it('PC "forwarded" statuses are all visible in the PC list', () => {
    for (const s of VIEWS.PC.find((v) => v.key === 'forwarded')!.statuses) {
      expect(LIST_STATUSES.PC).toContain(s);
    }
  });

  it('every view only uses statuses its list can show', () => {
    for (const [role, views] of Object.entries(VIEWS) as [keyof typeof VIEWS, typeof VIEWS.IC][]) {
      for (const v of views) for (const s of v.statuses) expect(LIST_STATUSES[role]).toContain(s);
    }
  });
});

describe('filterQuery', () => {
  it('keeps the filter when paging', () => {
    const f = parseListFilter('HOG', { view: 'approved' });
    expect(filterQuery(f, 2)).toBe('?view=approved&page=2');
    expect(filterQuery(parseListFilter('HOG', {}))).toBe('');
  });
});

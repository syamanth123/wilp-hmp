import { describe, expect, it } from 'vitest';
import { HandoutStatus } from '@hmp/db';
import {
  applyFilters,
  groupByCourse,
  matchesSearch,
  parseLibraryFilter,
  termLabel,
  type LibraryItem,
} from '../handout-library';

const item = (o: Partial<LibraryItem>): LibraryItem => ({
  kind: 'hmp',
  id: 'r1',
  courseKey: 'SS ZG653',
  courseCode: 'SS ZG653',
  courseTitle: 'Software Architectures',
  refNo: 'HMP-2026-0001',
  status: HandoutStatus.IN_PROGRESS,
  termKey: '2025-FIRST',
  semesterName: 'Sem-I 2025-26',
  programmeCode: 'MTECH-SE',
  faculty: ['Dr. Anaïs Pérez'],
  sme: 'Dr. Sneha Mehta',
  updatedAt: new Date('2026-07-01'),
  ...o,
});

describe('matchesSearch — forgiving', () => {
  it.each(['ss zg 653', 'SSZG653', 'SS ZG653', 'sszg653', 'zg653'])(
    'finds the course code from %j',
    (q) => {
      expect(matchesSearch(item({}), q)).toBe(true);
    },
  );
  it.each(['software', 'ARCHITECTURES', 'anais perez', 'pérez', 'sneha', 'hmp-2026-0001'])(
    'finds title, people and reference from %j',
    (q) => {
      expect(matchesSearch(item({}), q)).toBe(true);
    },
  );
  it.each(['ss zg 654', 'mechanical', 'HMP-2026-0002'])('does not match %j', (q) => {
    expect(matchesSearch(item({}), q)).toBe(false);
  });
  it('an empty query matches everything', () => {
    expect(matchesSearch(item({}), '  ')).toBe(true);
  });
});

describe('groupByCourse', () => {
  it('keeps one row per course — the latest — and counts the rest', () => {
    const groups = groupByCourse([
      item({ id: 'a', updatedAt: new Date('2026-01-01') }),
      item({ id: 'b', updatedAt: new Date('2026-03-01') }),
      item({
        id: 'c',
        courseKey: 'MBA ZC417',
        courseCode: 'MBA ZC417',
        updatedAt: new Date('2026-02-01'),
      }),
    ]);
    expect(groups.map((g) => [g.latest.id, g.olderCount])).toEqual([
      ['b', 1],
      ['c', 0],
    ]);
  });
});

describe('applyFilters', () => {
  const items = [
    item({ id: 'a' }),
    item({ id: 'b', status: HandoutStatus.SME_REVIEW, programmeCode: 'MBA-WILP' }),
    item({ id: 'c', termKey: '2024-SECOND' }),
  ];
  const all = { q: '', termKey: null, programme: '', statuses: null };
  it('filters by term, programme and status', () => {
    expect(applyFilters(items, { ...all, termKey: '2025-FIRST' }).map((i) => i.id)).toEqual([
      'a',
      'b',
    ]);
    expect(applyFilters(items, { ...all, programme: 'MBA-WILP' }).map((i) => i.id)).toEqual(['b']);
    expect(
      applyFilters(items, { ...all, statuses: [HandoutStatus.SME_REVIEW] }).map((i) => i.id),
    ).toEqual(['b']);
  });
  it('can leave one filter out (for that filter’s own counts)', () => {
    const a = { ...all, programme: 'MBA-WILP', statuses: [HandoutStatus.IN_PROGRESS] };
    expect(applyFilters(items, a)).toEqual([]);
    expect(applyFilters(items, a, 'statuses').map((i) => i.id)).toEqual(['b']);
  });
});

describe('parseLibraryFilter', () => {
  it('opens faculty on their own work and the IC on the published list, with the role default view', () => {
    expect(parseLibraryFilter({}, ['FACULTY'])).toMatchObject({
      tab: 'in-progress',
      view: 'needs-action',
    });
    expect(parseLibraryFilter({}, ['INSTRUCTION_CELL'])).toMatchObject({
      tab: 'published',
      view: 'this-term',
    });
  });
  it('ignores anything invalid in the address', () => {
    const f = parseLibraryFilter(
      { tab: 'secret', status: 'NOPE', term: '1; drop', page: '-3', view: 'x' },
      ['HOG'],
    );
    expect(f).toMatchObject({ tab: 'published', status: '', term: '', page: 1, view: 'this-term' });
  });
});

it('termLabel', () => {
  expect(termLabel('2025-FIRST')).toBe('2025-26 Sem 1');
  expect(termLabel('2024-SUMMER')).toBe('2024-25 Summer');
});

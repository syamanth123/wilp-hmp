import { describe, expect, it } from 'vitest';
import { DibbaCourseType, HandoutStatus, RoleName } from '@hmp/db';
import {
  EMPTY_FILTERS,
  applyPreds,
  courseCount,
  groupByCourse,
  libraryQuery,
  matchesSearch,
  notStartedItems,
  parseLibraryFilter,
  predicates,
  quickViews,
  sortItems,
  statusGroupOf,
  termKeyFromText,
  termLabel,
  type LibraryFilter,
  type LibraryItem,
  type ScheduledCourse,
  type ViewCtx,
} from '../handout-library';

const NOW = new Date('2026-11-03T06:00:00Z');
const DAY = 86_400_000;

const item = (o: Partial<LibraryItem>): LibraryItem => ({
  kind: 'hmp',
  id: 'r1',
  courseKey: 'SS ZG653',
  courseCode: 'SS ZG653',
  codes: o.codes ?? [o.courseCode ?? 'SS ZG653'],
  courseTitle: 'Software Architectures',
  refNo: 'HMP-2026-0001',
  status: HandoutStatus.IN_PROGRESS,
  group: 'writing',
  termKey: '2025-FIRST',
  semesterName: 'Sem-I 2025-26',
  programmeCode: 'MTECH-SE',
  programmes: [],
  discipline: 'SS',
  faculty: ['Dr. Anaïs Pérez'],
  facultyIds: ['fac-1'],
  sme: 'Dr. Sneha Mehta',
  smeId: 'sme-1',
  allocatedBy: 'HOG One',
  allocatedById: 'hog-1',
  updatedAt: new Date('2026-07-01'),
  dueAt: null,
  publishedAt: null,
  taxila: null,
  sentBack: 0,
  mine: false,
  reviewedByMe: false,
  schedule: [],
  ...o,
});

const ctx = (o: Partial<ViewCtx> = {}): ViewCtx => ({
  now: NOW,
  userId: 'fac-1',
  myCourseCodes: new Set(),
  currentTerm: '2025-FIRST',
  ...o,
});

const filter = (o: Partial<LibraryFilter> = {}): LibraryFilter => ({
  tab: 'in-progress',
  view: '',
  sort: 'updated',
  dir: '',
  page: 1,
  ...EMPTY_FILTERS,
  ...o,
});

const ids = (xs: LibraryItem[]) => xs.map((x) => x.id);
const run = (items: LibraryItem[], f: LibraryFilter, roles: RoleName[] = [], c = ctx()) =>
  ids(
    applyPreds(
      items,
      predicates(
        f,
        quickViews(roles).find((v) => v.key === f.view),
        c,
      ),
    ),
  );

describe('matchesSearch — forgiving', () => {
  it.each(['ss zg 653', 'SSZG653', 'SS ZG653', 'sszg653', 'zg653'])(
    'finds the course code from %j',
    (q) => expect(matchesSearch(item({}), q)).toBe(true),
  );
  it.each(['software', 'ARCHITECTURES', 'anais perez', 'pérez', 'sneha', 'hmp-2026-0001'])(
    'finds title, people and reference from %j',
    (q) => expect(matchesSearch(item({}), q)).toBe(true),
  );
  it.each(['ss zg 654', 'mechanical', 'HMP-2026-0002'])('does not match %j', (q) =>
    expect(matchesSearch(item({}), q)).toBe(false),
  );
  it('finds a cross-listed code', () => {
    expect(matchesSearch(item({ codes: ['SS ZG653', 'CS ZG653'] }), 'cszg653')).toBe(true);
  });
  it('an empty query matches everything', () => {
    expect(matchesSearch(item({}), '  ')).toBe(true);
  });
});

describe('groupByCourse + sort', () => {
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
  it('sorts by due date, soonest first, undated last', () => {
    const xs = [
      item({ id: 'none' }),
      item({ id: 'late', dueAt: new Date(NOW.getTime() + 9 * DAY) }),
      item({ id: 'soon', dueAt: new Date(NOW.getTime() + DAY) }),
    ];
    expect(ids(sortItems(xs, 'due'))).toEqual(['soon', 'late', 'none']);
    expect(ids(sortItems(xs, 'due', 'desc'))).toEqual(['late', 'soon', 'none']);
  });
  it('sorts by course code and by status order', () => {
    const xs = [
      item({ id: 'b', courseCode: 'SS ZG653', group: 'sent-back' }),
      item({ id: 'a', courseCode: 'AE ZG511', group: 'allocating' }),
    ];
    expect(ids(sortItems(xs, 'code'))).toEqual(['a', 'b']);
    expect(ids(sortItems(xs, 'status'))).toEqual(['a', 'b']);
  });
});

describe('filters', () => {
  const items = [
    item({ id: 'a' }),
    item({
      id: 'b',
      status: HandoutStatus.SME_REVIEW,
      group: 'with-sme',
      programmeCode: 'MBA-WILP',
    }),
    item({ id: 'c', termKey: '2024-SECOND' }),
    item({ id: 'd', status: HandoutStatus.DRAFT, group: 'draft' }),
    item({
      id: 'n',
      kind: 'not-started',
      group: 'not-started',
      status: null,
      programmes: ['HT01'],
    }),
  ];
  it('defaults to the current semester and hides drafts, rejected and not-started (D2)', () => {
    expect(run(items, filter())).toEqual(['a', 'b']);
  });
  it('drafts and not-started appear only when picked in the status filter', () => {
    expect(run(items, filter({ status: 'draft' }))).toEqual(['d']);
    expect(run(items, filter({ status: 'not-started' }))).toEqual(['n']);
  });
  it('semester, programme (HMP or schedule) and status', () => {
    expect(run(items, filter({ term: 'all' }))).toEqual(['a', 'b', 'c']);
    expect(run(items, filter({ term: '2024-SECOND' }))).toEqual(['c']);
    expect(run(items, filter({ programme: 'MBA-WILP' }))).toEqual(['b']);
    expect(run(items, filter({ programme: 'HT01', status: 'not-started' }))).toEqual(['n']);
    expect(run(items, filter({ status: 'with-sme' }))).toEqual(['b']);
  });
  it('a filter that means nothing on a tab is ignored there', () => {
    expect(
      run([item({ id: 'p', kind: 'past', group: null })], filter({ tab: 'past', due: 'overdue' })),
    ).toEqual(['p']);
  });
  it('due: overdue, next 7 days, custom range (India dates)', () => {
    const xs = [
      item({ id: 'over', dueAt: new Date(NOW.getTime() - DAY) }),
      item({ id: 'week', dueAt: new Date(NOW.getTime() + 3 * DAY) }),
      item({ id: 'month', dueAt: new Date(NOW.getTime() + 20 * DAY) }),
      item({ id: 'none' }),
    ];
    expect(run(xs, filter({ due: 'overdue' }))).toEqual(['over']);
    expect(run(xs, filter({ due: '7d' }))).toEqual(['week']);
    expect(run(xs, filter({ due: '30d' }))).toEqual(['week', 'month']);
    expect(run(xs, filter({ dueFrom: '2026-11-06', dueTo: '2026-11-06' }))).toEqual(['week']);
  });
  it('updated today uses the India-time day', () => {
    const xs = [
      item({ id: 'today', updatedAt: new Date('2026-11-02T19:00:00Z') }), // 3 Nov 00:30 IST
      item({ id: 'yesterday', updatedAt: new Date('2026-11-02T18:00:00Z') }), // 2 Nov 23:30 IST
    ];
    expect(run(xs, filter({ updated: 'today' }))).toEqual(['today']);
  });
  it('schedule, Taxila, sent back, people', () => {
    const sched = [{ slot: 3, day: 'SAT', session: 'FN', type: DibbaCourseType.CORE }];
    const xs = [
      item({ id: 's', schedule: sched, sentBack: 2, facultyIds: ['f2'] }),
      item({ id: 't', sentBack: 1, smeId: 'sme-9' }),
    ];
    expect(run(xs, filter({ slot: '3' }))).toEqual(['s']);
    expect(run(xs, filter({ day: 'SAT', session: 'FN', ctype: 'CORE' }))).toEqual(['s']);
    expect(run(xs, filter({ sched: 'no' }))).toEqual(['t']);
    expect(run(xs, filter({ sentback: '2' }))).toEqual(['s']);
    expect(run(xs, filter({ faculty: 'f2' }))).toEqual(['s']);
    expect(run(xs, filter({ sme: 'sme-9' }))).toEqual(['t']);
    const pub = [
      item({ id: 'x', group: 'published', taxila: 'sent' }),
      item({ id: 'y', group: 'approved', taxila: 'none' }),
    ];
    expect(run(pub, filter({ tab: 'published', taxila: 'none' }))).toEqual(['y']);
  });
  it('facets skip their own filter', () => {
    const preds = predicates(
      filter({ programme: 'MBA-WILP', status: 'writing' }),
      undefined,
      ctx(),
    );
    expect(ids(applyPreds(items, preds))).toEqual([]);
    expect(ids(applyPreds(items, preds, ['status']))).toEqual(['b']);
  });
});

describe('quick views follow the brief’s role table', () => {
  const keys = (roles: RoleName[]) => quickViews(roles).map((v) => v.key);
  it('IC: this semester first, then not started / overdue / approved-not-published / this week', () => {
    expect(keys([RoleName.INSTRUCTION_CELL])).toEqual([
      'this-term',
      'not-started',
      'overdue',
      'not-published',
      'published-week',
    ]);
  });
  it('Admin: as IC + past BITS handouts awaiting approval (a link out)', () => {
    const vs = quickViews([RoleName.ADMIN]);
    expect(vs.map((v) => v.key)).toEqual([...keys([RoleName.INSTRUCTION_CELL]), 'corpus-awaiting']);
    expect(vs.at(-1)!.href).toBe('/admin/corpus-imports');
  });
  it('HOG / PC: needs my action first', () => {
    for (const r of [RoleName.HOG, RoleName.PROGRAMME_COMMITTEE]) {
      expect(keys([r])).toEqual([
        'needs-action',
        'overdue',
        'sent-back',
        'not-published',
        'changed-a-lot',
      ]);
    }
  });
  it('Faculty: needs my action, due this week, sent back, published (mine), last year', () => {
    expect(keys([RoleName.FACULTY])).toEqual([
      'needs-action',
      'due-week',
      'sent-back',
      'mine-published',
      'last-year',
    ]);
  });
  it('SME: waiting for my review, reviewed by me, published', () => {
    const vs = quickViews([RoleName.SME]);
    expect(vs.map((v) => v.key)).toEqual(['needs-action', 'reviewed', 'mine-published']);
    expect(vs[0]!.label).toBe('Waiting for my review');
  });

  it('needs my action = the dashboard action statuses, own work only for faculty', () => {
    const xs = [
      item({ id: 'mine', status: HandoutStatus.IN_PROGRESS, facultyIds: ['fac-1'] }),
      item({ id: 'other', status: HandoutStatus.IN_PROGRESS, facultyIds: ['fac-2'] }),
      item({
        id: 'review',
        status: HandoutStatus.SME_REVIEW,
        group: 'with-sme',
        facultyIds: ['fac-1'],
      }),
    ];
    expect(run(xs, filter({ view: 'needs-action' }), [RoleName.FACULTY])).toEqual(['mine']);
    const hog = [
      item({ id: 'req', status: HandoutStatus.REQUESTED, group: 'allocating' }),
      item({ id: 'ur', status: HandoutStatus.UNDER_REVIEW, group: 'with-reviewer' }),
      item({ id: 'ip', status: HandoutStatus.IN_PROGRESS }),
    ];
    expect(run(hog, filter({ view: 'needs-action' }), [RoleName.HOG])).toEqual(['req', 'ur']);
    expect(run(hog, filter({ view: 'needs-action' }), [RoleName.PROGRAMME_COMMITTEE])).toEqual([]);
  });
  it('not started yet = scheduled courses with no handout, current semester', () => {
    const xs = [
      item({ id: 'a' }),
      item({ id: 'n', kind: 'not-started', group: 'not-started', status: null }),
      item({
        id: 'old',
        kind: 'not-started',
        group: 'not-started',
        status: null,
        termKey: '2024-FIRST',
      }),
    ];
    expect(run(xs, filter({ view: 'not-started' }), [RoleName.INSTRUCTION_CELL])).toEqual(['n']);
  });
  it('overdue, published this week, last year’s handout for my courses', () => {
    const ic = [RoleName.INSTRUCTION_CELL];
    const xs = [
      item({ id: 'late', dueAt: new Date(NOW.getTime() - DAY), termKey: '2023-FIRST' }),
      item({ id: 'ok', dueAt: new Date(NOW.getTime() + DAY) }),
    ];
    expect(run(xs, filter({ view: 'overdue' }), ic)).toEqual(['late']);
    const pub = [
      item({ id: 'new', group: 'published', publishedAt: new Date(NOW.getTime() - 2 * DAY) }),
      item({ id: 'old', group: 'published', publishedAt: new Date(NOW.getTime() - 20 * DAY) }),
    ];
    expect(run(pub, filter({ tab: 'published', view: 'published-week' }), ic)).toEqual(['new']);
    const past = [
      item({ id: 'p1', kind: 'past', group: null, codes: ['SS ZG653'] }),
      item({ id: 'p2', kind: 'past', group: null, codes: ['MBA ZC417'] }),
    ];
    expect(
      run(
        past,
        filter({ tab: 'past', view: 'last-year' }),
        [RoleName.FACULTY],
        ctx({ myCourseCodes: new Set(['SS ZG653']) }),
      ),
    ).toEqual(['p1']);
  });
});

describe('address ↔ filter', () => {
  it('a bare address opens the role’s default view and tab', () => {
    expect(parseLibraryFilter({}, [RoleName.FACULTY])).toMatchObject({
      tab: 'in-progress',
      view: 'needs-action',
    });
    expect(parseLibraryFilter({}, [RoleName.INSTRUCTION_CELL])).toMatchObject({
      tab: 'in-progress',
      view: 'this-term',
    });
    expect(parseLibraryFilter({}, [RoleName.HOG])).toMatchObject({
      tab: 'in-progress',
      view: 'needs-action',
    });
  });
  it('a tab link without a view shows the whole tab', () => {
    expect(parseLibraryFilter({ tab: 'published' }, [RoleName.FACULTY])).toMatchObject({
      tab: 'published',
      view: '',
    });
  });
  it('ignores anything invalid in the address', () => {
    const f = parseLibraryFilter(
      {
        tab: 'secret',
        status: 'NOPE',
        term: '1; drop',
        page: '-3',
        view: 'x',
        due: 'soon',
        sort: 'evil',
      },
      [RoleName.HOG],
    );
    expect(f).toMatchObject({
      tab: 'in-progress',
      status: '',
      term: '',
      due: '',
      page: 1,
      view: '',
      sort: 'updated',
    });
  });
  it('faculty and SMEs get no people filters', () => {
    expect(parseLibraryFilter({ faculty: 'fac-2', sme: 'x' }, [RoleName.FACULTY])).toMatchObject({
      faculty: '',
      sme: '',
    });
    expect(parseLibraryFilter({ faculty: 'fac-2' }, [RoleName.HOG])).toMatchObject({
      faculty: 'fac-2',
    });
  });
  it('round-trips through the address', () => {
    const f = parseLibraryFilter(
      {
        tab: 'published',
        q: 'ss zg 653',
        term: 'all',
        programme: 'MBA-WILP',
        status: 'approved',
        taxila: 'none',
        sort: 'due',
        dir: 'desc',
        page: '2',
      },
      [RoleName.INSTRUCTION_CELL],
    );
    const back = parseLibraryFilter(Object.fromEntries(new URLSearchParams(libraryQuery(f))), [
      RoleName.INSTRUCTION_CELL,
    ]);
    expect(back).toEqual(f);
  });
});

describe('not started yet', () => {
  const at = (slot: number, day = 'SAT', session = 'FN') => ({
    slot,
    day,
    session,
    type: DibbaCourseType.CORE,
  });
  const course = (
    code: string,
    title: string,
    programme: string,
    slot = at(1),
    catalogueTitle: string | null = null,
  ): ScheduledCourse => ({
    term: '2025-FIRST',
    code,
    title,
    catalogueTitle,
    programmes: new Set([programme]),
    at: NOW,
    slots: [slot],
    links: new Set([`${title}|${slot.slot}|${slot.day}|${slot.session}`]),
  });
  const sched = (...cs: ScheduledCourse[]) =>
    new Map(cs.map((c) => [`${c.term}|${c.code}`, c] as const));

  it('lists scheduled courses that have no handout in that semester', () => {
    const schedule = sched(
      course('SS ZG653', 'SA', 'HT01'),
      course('AE ZG511', 'AE', 'HT02', at(2)),
    );
    const out = notStartedItems(schedule, [item({ codes: ['SS ZG653'] })], new Map());
    expect(out.map((x) => x.courseCode)).toEqual(['AE ZG511']);
    expect(out[0]).toMatchObject({ group: 'not-started', programmes: ['HT02'] });
  });

  it('cross-listed codes (same title, same slot) are one row, counted once', () => {
    const schedule = sched(
      course('ET ZC232', 'ENGINEERING MATERIALS', 'ET01'),
      course('ENGG ZC232', 'ENGINEERING MATERIALS', 'EN01'),
      course('ET ZC233', 'CALCULUS', 'ET01', at(2, 'SAT', 'AN')),
      course('MATH ZC233', 'CALCULUS', 'MA01', at(2, 'SAT', 'AN')),
      // Same title, another slot: a different class.
      course('PE ZC233', 'CALCULUS', 'PE01', at(5, 'SUN', 'EV')),
    );
    const out = notStartedItems(schedule, [], new Map());
    expect(out.map((x) => x.codes.join(' / ')).sort()).toEqual([
      'ENGG ZC232 / ET ZC232',
      'ET ZC233 / MATH ZC233',
      'PE ZC233',
    ]);
    expect(courseCount(out)).toBe(3);
    const mat = out.find((x) => x.codes.includes('ET ZC232'))!;
    expect(mat.programmes).toEqual(['EN01', 'ET01']);
    expect(mat.courseTitle).toBe('Engineering Materials');
  });

  it('a request for any cross-listed code covers the whole class', () => {
    const schedule = sched(
      course('ET ZC232', 'ENGINEERING MATERIALS', 'ET01'),
      course('ENGG ZC232', 'ENGINEERING MATERIALS', 'EN01'),
    );
    expect(notStartedItems(schedule, [item({ codes: ['ET ZC232'] })], new Map())).toEqual([]);
  });

  it('the catalogue code and title lead', () => {
    const schedule = sched(
      course('ET ZC232', 'ENGG MATERIALS', 'ET01'),
      course('MATH ZC232', 'ENGG MATERIALS', 'MA01', at(1), 'Engineering Materials Science'),
    );
    const [row] = notStartedItems(schedule, [], new Map());
    expect(row).toMatchObject({
      courseCode: 'MATH ZC232',
      codes: ['MATH ZC232', 'ET ZC232'],
      courseTitle: 'Engineering Materials Science',
    });
  });

  it('shows no Updated date, so the Updated filters skip it', () => {
    const [row] = notStartedItems(sched(course('AE ZG511', 'AE', 'HT02')), [], new Map());
    expect(
      run([row!], filter({ view: 'not-started', updated: 'today' }), [RoleName.INSTRUCTION_CELL]),
    ).toEqual([]);
  });
});

it('approved + sent to Taxila counts as published', () => {
  expect(statusGroupOf(HandoutStatus.APPROVED, false)).toBe('approved');
  expect(statusGroupOf(HandoutStatus.APPROVED, true)).toBe('published');
  expect(statusGroupOf(HandoutStatus.REWORK_REQUESTED, false)).toBe('sent-back');
});

it('termLabel / termKeyFromText', () => {
  expect(termLabel('2025-FIRST')).toBe('2025-26 Sem 1');
  expect(termLabel('2024-SUMMER')).toBe('2024-25 Summer');
  expect(termKeyFromText('First Semester 2025-2026')).toBe('2025-FIRST');
  expect(termKeyFromText('SECOND SEMESTER 2023-24')).toBe('2023-SECOND');
  expect(termKeyFromText('Sem II 2022-23')).toBe('2022-SECOND');
  expect(termKeyFromText('Summer Term 2024')).toBe('2024-SUMMER');
  expect(termKeyFromText('2024')).toBeNull();
  expect(termKeyFromText(null)).toBeNull();
});

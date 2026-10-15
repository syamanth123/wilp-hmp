import { describe, it, expect } from 'vitest';
import {
  buildCodeGroups,
  buildSchedule,
  expandEquivalentCodes,
  groupKeyFor,
  nextEvents,
  normalizeTitleKey,
  pickActiveTerm,
  type BuildScheduleInput,
  type EntryLike,
} from '../dibba-schedule';

const TERM = {
  id: 't1',
  name: '2025-26 Sem 1',
  year: 2025,
  term: 'FIRST',
  startDate: new Date(2025, 7, 1),
  endDate: new Date(2025, 11, 15),
};
const PUBLISHED = { id: 'imp1', label: 'As on 02.07.2025', publishedAt: new Date(2025, 6, 2) };

const entry = (over: Partial<EntryLike> & Pick<EntryLike, 'courseCode' | 'slotNo'>): EntryLike => ({
  courseTitle: 'Some Course',
  slotDay: null,
  slotSession: null,
  programmeCode: 'HT01',
  programmeTitle: 'M.Tech. Software Systems',
  admitBatch: '2/2024',
  studentCount: 10,
  isBacklogRow: false,
  classTimeHint: null,
  ...over,
});

const base = (over: Partial<BuildScheduleInput>): BuildScheduleInput => ({
  term: TERM,
  published: PUBLISHED,
  entries: [],
  sources: new Map(),
  instructors: [],
  myUserId: 'me',
  catalogue: [],
  timings: [
    { slotNo: 1, day: 'SAT', session: 'FN', startTime: '09:00', endTime: '12:00' },
    { slotNo: 2, day: 'SAT', session: 'AN', startTime: null, endTime: null },
    { slotNo: 3, day: 'SUN', session: 'FN', startTime: '09:00', endTime: '12:00' },
  ],
  examDates: [],
  ...over,
});

describe('pickActiveTerm', () => {
  const t = (name: string, start: Date, end: Date, hasPublished = true) => ({
    name,
    startDate: start,
    endDate: end,
    hasPublished,
  });
  it('prefers the term containing today, then the next upcoming, then the latest past', () => {
    const now = new Date(2025, 9, 1);
    const past = t('past', new Date(2024, 7, 1), new Date(2024, 11, 15));
    const current = t('current', new Date(2025, 7, 1), new Date(2025, 11, 15));
    const next = t('next', new Date(2026, 0, 10), new Date(2026, 4, 20));
    expect(pickActiveTerm([past, current, next], now)?.name).toBe('current');
    expect(pickActiveTerm([past, next], now)?.name).toBe('next');
    expect(
      pickActiveTerm([past, t('older', new Date(2023, 7, 1), new Date(2023, 11, 15))], now)?.name,
    ).toBe('past');
  });
  it('between two terms containing today, the most recently published schedule wins', () => {
    const now = new Date(2025, 9, 1);
    const older = {
      ...t('older', new Date(2025, 6, 1), new Date(2025, 11, 31)),
      publishedAt: new Date(2025, 5, 1),
    };
    const newer = {
      ...t('newer', new Date(2025, 7, 1), new Date(2025, 11, 15)),
      publishedAt: new Date(2025, 8, 20),
    };
    expect(pickActiveTerm([older, newer], now)?.name).toBe('newer');
    expect(pickActiveTerm([newer, older], now)?.name).toBe('newer');
  });
  it('ignores terms without a published import', () => {
    const now = new Date(2025, 9, 1);
    expect(
      pickActiveTerm([t('draft-only', new Date(2025, 7, 1), new Date(2025, 11, 15), false)], now),
    ).toBeNull();
  });
});

describe('grouping', () => {
  const catalogue = [
    { bitsCourseNumber: 'AAOC ZC111', alternateCodes: ['SS ZC111', 'CS ZC111'] },
    { bitsCourseNumber: 'CS ZG501', alternateCodes: [] },
  ];
  it('maps a course number and each alternate to the catalogue course', () => {
    const groups = buildCodeGroups(catalogue);
    expect(groupKeyFor('SS ZC111', 'x', groups)).toBe('AAOC ZC111');
    expect(groupKeyFor('aaoc  zc111', 'x', groups)).toBe('AAOC ZC111');
    expect(groupKeyFor('CS ZG501', 'x', groups)).toBe('CS ZG501');
  });
  it('falls back to a normalized title key for unknown codes', () => {
    const groups = buildCodeGroups(catalogue);
    expect(groupKeyFor('XX ZG999', 'Data  Mining: Advanced', groups)).toBe(
      'title:data mining advanced',
    );
    expect(normalizeTitleKey('DATA-MINING (advanced)')).toBe('data mining advanced');
  });
  it('expandEquivalentCodes adds every alternate of a matched course', () => {
    expect([...expandEquivalentCodes(['ss zc111'], catalogue)].sort()).toEqual([
      'AAOC ZC111',
      'CS ZC111',
      'SS ZC111',
    ]);
    expect([...expandEquivalentCodes(['ZZ ZG100'], catalogue)]).toEqual(['ZZ ZG100']);
  });
});

describe('buildSchedule', () => {
  it('merges cross-listed codes into one card and never reports them as a clash', () => {
    const s = buildSchedule(
      base({
        entries: [
          entry({
            courseCode: 'AAOC ZC111',
            slotNo: 1,
            courseTitle: 'Probability',
            programmeCode: 'HT01',
            studentCount: 40,
          }),
          entry({
            courseCode: 'SS ZC111',
            slotNo: 1,
            courseTitle: 'Probability',
            programmeCode: 'HB28',
            studentCount: 25,
          }),
        ],
        sources: new Map([['SS ZC111', new Set(['instructor' as const])]]),
        catalogue: [{ bitsCourseNumber: 'AAOC ZC111', alternateCodes: ['SS ZC111'] }],
      }),
    );
    expect(s.courses).toHaveLength(1);
    expect(s.courses[0]).toMatchObject({
      key: 'AAOC ZC111',
      codes: ['AAOC ZC111', 'SS ZC111'],
      students: 65,
      clash: false,
    });
    expect(s.courses[0]!.slots[0]!.rows.map((r) => r.programmeCode)).toEqual(['HT01', 'HB28']);
    expect(s.clashes).toEqual([]);
    expect(s.grid.find((g) => g.slotNo === 1)).toMatchObject({
      codes: ['AAOC ZC111', 'SS ZC111'],
      clash: false,
      startTime: '09:00',
    });
  });

  it('flags two different courses in one slot as a clash, on the cards, the grid and the list', () => {
    const s = buildSchedule(
      base({
        entries: [
          entry({ courseCode: 'CS ZG501', slotNo: 3, courseTitle: 'Software Architecture' }),
          entry({ courseCode: 'SE ZG503', slotNo: 3, courseTitle: 'Requirements' }),
          entry({
            courseCode: 'SE ZG503',
            slotNo: 2,
            courseTitle: 'Requirements',
            programmeCode: 'HB28',
          }),
        ],
      }),
    );
    expect(s.courses.map((c) => [c.key, c.clash])).toEqual([
      ['title:software architecture', true],
      ['title:requirements', true],
    ]);
    expect(s.clashes).toEqual([
      {
        slotNo: 3,
        day: 'SUN',
        session: 'FN',
        courseKeys: ['title:requirements', 'title:software architecture'],
        codes: ['SE ZG503', 'CS ZG501'],
      },
    ]);
    const se = s.courses.find((c) => c.key === 'title:requirements')!;
    expect(se.slots.map((x) => [x.slotNo, x.clash])).toEqual([
      [2, false],
      [3, true],
    ]);
    expect(s.grid.find((g) => g.slotNo === 3)!.clash).toBe(true);
    expect(s.grid.find((g) => g.slotNo === 2)!.clash).toBe(false);
  });

  it('keeps slot-0 rows off the grid and out of clashes, and lists co-instructors (not me)', () => {
    const s = buildSchedule(
      base({
        entries: [
          entry({ courseCode: 'CS ZG628T', slotNo: 0, courseTitle: 'Dissertation' }),
          entry({ courseCode: 'CS ZG501', slotNo: 1, courseTitle: 'SA' }),
        ],
        instructors: [
          { courseCode: 'CS ZG501', userId: 'me', userName: 'Me', isLead: true },
          { courseCode: 'CS ZG501', userId: 'u2', userName: 'Zed', isLead: false },
          { courseCode: 'CS ZG501', userId: 'u3', userName: 'Anu', isLead: true },
          { courseCode: 'CS ZG501', userId: 'u3', userName: 'Anu', isLead: false },
        ],
        sources: new Map([['CS ZG501', new Set(['assignment' as const, 'instructor' as const])]]),
        examDates: [
          {
            slotNo: 1,
            kind: 'MID_SEM',
            date: new Date(2025, 9, 5),
            startTime: '10:00',
            endTime: null,
          },
          {
            slotNo: 1,
            kind: 'COMPREHENSIVE',
            date: new Date(2025, 11, 20),
            startTime: null,
            endTime: null,
          },
        ],
      }),
    );
    expect(s.noSlot.map((c) => c.codes)).toEqual([['CS ZG628T']]);
    expect(s.courses).toHaveLength(1);
    expect(s.courses[0]!.coInstructors).toEqual([
      { name: 'Anu', isLead: true },
      { name: 'Zed', isLead: false },
    ]);
    expect(s.courses[0]!.sources).toEqual(['assignment', 'instructor']);
    expect(s.courses[0]!.slots[0]!.exams.map((e) => e.kind)).toEqual(['MID_SEM', 'COMPREHENSIVE']);
    expect(s.clashes).toEqual([]);
    expect(s.grid.every((g) => g.codes.every((c) => c !== 'CS ZG628T'))).toBe(true);
  });

  it('uses the Dibba class-time hint when the term has no class time for the slot', () => {
    const s = buildSchedule(
      base({
        entries: [entry({ courseCode: 'CS ZG501', slotNo: 2, classTimeHint: 'SAT 14:00' })],
      }),
    );
    expect(s.courses[0]!.slots[0]).toMatchObject({
      startTime: null,
      classTimeHint: 'SAT 14:00',
      day: 'SAT',
      session: 'AN',
    });
  });
});

describe('nextEvents', () => {
  const schedule = buildSchedule(
    base({
      entries: [
        entry({ courseCode: 'CS ZG501', slotNo: 1 }), // SAT FN 09:00-12:00
        entry({ courseCode: 'SE ZG503', slotNo: 3, courseTitle: 'Req' }), // SUN FN 09:00-12:00
      ],
      examDates: [
        { slotNo: 3, kind: 'MID_SEM', date: new Date(2025, 9, 12), startTime: null, endTime: null },
        {
          slotNo: 1,
          kind: 'MID_SEM',
          date: new Date(2025, 9, 4),
          startTime: '10:00',
          endTime: null,
        },
        {
          slotNo: 1,
          kind: 'COMPREHENSIVE',
          date: new Date(2025, 11, 20),
          startTime: null,
          endTime: null,
        },
      ],
    }),
  );

  it('picks the earliest upcoming slot occurrence; today counts until the class ends', () => {
    // Wednesday 1 Oct 2025 → Saturday 4 Oct (slot 1) before Sunday 5 Oct (slot 3).
    const wed = nextEvents(schedule, new Date(2025, 9, 1, 8, 0));
    expect(wed.nextClass).toMatchObject({ slotNo: 1, day: 'SAT', date: new Date(2025, 9, 4) });
    // Saturday 4 Oct 08:00: slot 1 is today. 13:00: it has ended → Sunday 5 Oct (slot 3).
    expect(nextEvents(schedule, new Date(2025, 9, 4, 8, 0)).nextClass?.date).toEqual(
      new Date(2025, 9, 4),
    );
    expect(nextEvents(schedule, new Date(2025, 9, 4, 13, 0)).nextClass).toMatchObject({
      slotNo: 3,
      date: new Date(2025, 9, 5),
    });
  });

  it('picks the earliest exam on or after today, across my slots only', () => {
    expect(nextEvents(schedule, new Date(2025, 9, 1)).nextExam).toMatchObject({
      slotNo: 1,
      kind: 'MID_SEM',
      date: new Date(2025, 9, 4),
    });
    expect(nextEvents(schedule, new Date(2025, 9, 4, 23, 0)).nextExam?.date).toEqual(
      new Date(2025, 9, 4),
    );
    expect(nextEvents(schedule, new Date(2025, 9, 5)).nextExam).toMatchObject({
      slotNo: 3,
      date: new Date(2025, 9, 12),
    });
    expect(nextEvents(schedule, new Date(2026, 0, 1)).nextExam).toBeNull();
  });

  it('is empty for an empty schedule', () => {
    expect(nextEvents({ ...schedule, courses: [] }, new Date())).toEqual({
      nextClass: null,
      nextExam: null,
    });
  });
});

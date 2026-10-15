import { describe, it, expect } from 'vitest';
import {
  buildTermOverview,
  slotNoFromSlotInfo,
  type OverviewEntry,
  type OverviewInstructor,
} from '../dibba-schedule/overview';

const e = (
  courseCode: string,
  slotNo: number,
  programmeCode = 'HT01',
  students = 10,
  courseId: string | null = 'c',
): OverviewEntry => ({
  courseCode,
  courseTitle: `${courseCode} title`,
  slotNo,
  programmeCode,
  studentCount: students,
  courseId,
});
const i = (
  courseCode: string,
  userId: string,
  over: Partial<OverviewInstructor> = {},
): OverviewInstructor => ({
  courseCode,
  userId,
  name: `User ${userId}`,
  facultyType: 'ON_CAMPUS',
  source: 'sheet',
  isLead: false,
  ...over,
});

describe('slotNoFromSlotInfo', () => {
  it('reads SLn, Slot n, a bare digit, or a day/session pair', () => {
    expect(slotNoFromSlotInfo('SL3')).toBe(3);
    expect(slotNoFromSlotInfo('Slot 7 (evening)')).toBe(7);
    expect(slotNoFromSlotInfo('4')).toBe(4);
    expect(slotNoFromSlotInfo('SAT AN')).toBe(2);
    expect(slotNoFromSlotInfo('Sunday EN')).toBe(8);
    expect(slotNoFromSlotInfo('TBD')).toBeNull();
    expect(slotNoFromSlotInfo('SL9')).toBeNull();
  });
});

describe('buildTermOverview', () => {
  it('lists courses with slots, programmes, totals and instructors; counts uncovered and not-in-catalogue', () => {
    const o = buildTermOverview({
      entries: [
        e('CS ZG501', 1, 'HT01', 30),
        e('CS ZG501', 1, 'HB28', 20),
        e('SE ZG503', 3),
        e('XX ZG999', 2, 'HT01', 5, null),
        e('CS ZG628T', 0),
      ],
      instructors: [
        i('CS ZG501', 'a', { isLead: true }),
        i('CS ZG501', 'a'),
        i('SE ZG503', 'b', { source: 'assignment' }),
      ],
      offerings: [],
      catalogue: [],
      offCampusMaxCourses: 3,
    });
    expect(
      o.courses.map((c) => [c.code, c.slotNos, c.programmes, c.students, c.instructors.length]),
    ).toEqual([
      ['CS ZG501', [1], ['HB28', 'HT01'], 50, 1],
      ['CS ZG628T', [0], ['HT01'], 10, 0],
      ['SE ZG503', [3], ['HT01'], 10, 1],
      ['XX ZG999', [2], ['HT01'], 5, 0],
    ]);
    expect(o.courses[0]!.instructors[0]).toMatchObject({ userId: 'a', isLead: true });
    expect(o.programmes).toEqual(['HB28', 'HT01']);
    // Uncovered: has a real slot and nobody teaches it (the slot-0 dissertation is not listed).
    expect(o.uncovered.map((c) => c.code)).toEqual(['XX ZG999']);
    expect(o.notInCatalogue).toEqual([{ code: 'XX ZG999', title: 'XX ZG999 title' }]);
    expect(o.faculty.map((f) => [f.userId, f.courseCount])).toEqual([
      ['a', 1],
      ['b', 1],
    ]);
  });

  it('finds clashes per faculty across both sources, merging equivalent codes', () => {
    const o = buildTermOverview({
      entries: [e('AAOC ZC111', 1), e('SS ZC111', 1), e('CS ZG501', 1), e('SE ZG503', 2)],
      instructors: [
        i('AAOC ZC111', 'a'),
        i('SS ZC111', 'a', { source: 'manual' }), // same course as AAOC → no clash by itself
        i('CS ZG501', 'a', { source: 'assignment' }), // different course, same slot 1 → clash
        i('SE ZG503', 'b'),
        i('CS ZG501', 'b'), // b: slots 2 and 1 → no clash
      ],
      offerings: [],
      catalogue: [{ bitsCourseNumber: 'AAOC ZC111', alternateCodes: ['SS ZC111'] }],
      offCampusMaxCourses: 3,
    });
    expect(o.clashes).toEqual([
      {
        userId: 'a',
        name: 'User a',
        slotNo: 1,
        day: 'SAT',
        session: 'FN',
        codes: ['AAOC ZC111', 'CS ZG501', 'SS ZC111'],
      },
    ]);
    expect(o.faculty.find((f) => f.userId === 'a')?.courseCount).toBe(2);
  });

  it('reports off-campus faculty over the course limit, by merged course count', () => {
    const o = buildTermOverview({
      entries: [
        e('A ZG101', 1),
        e('B ZG102', 2),
        e('C ZG103', 3),
        e('D ZG104', 4),
        e('E ZG105', 5),
      ],
      instructors: [
        ...['A ZG101', 'B ZG102', 'C ZG103', 'D ZG104'].map((c) =>
          i(c, 'off', { facultyType: 'OFF_CAMPUS' }),
        ),
        ...['A ZG101', 'B ZG102', 'C ZG103', 'D ZG104', 'E ZG105'].map((c) =>
          i(c, 'on', { facultyType: 'ON_CAMPUS' }),
        ),
        ...['A ZG101', 'B ZG102', 'C ZG103'].map((c) =>
          i(c, 'off2', { facultyType: 'OFF_CAMPUS' }),
        ),
      ],
      offerings: [],
      catalogue: [],
      offCampusMaxCourses: 3,
    });
    expect(o.offCampusLoad.map((f) => [f.userId, f.courseCount, f.limit])).toEqual([['off', 4, 3]]);
  });

  it('flags slot drift when an offering states a slot the Dibba does not use for that course', () => {
    const o = buildTermOverview({
      entries: [e('CS ZG501', 1), e('CS ZG501', 3), e('SE ZG503', 2)],
      instructors: [],
      offerings: [
        { courseCode: 'CS ZG501', slotInfo: 'SL3', semesterName: 'Sem-I', programmeCode: 'HT01' }, // matches one of the Dibba slots
        {
          courseCode: 'SE ZG503',
          slotInfo: 'Slot 5',
          semesterName: 'Sem-I',
          programmeCode: 'HT01',
        }, // drift
        { courseCode: 'SE ZG503', slotInfo: 'TBD', semesterName: 'Sem-I', programmeCode: 'HB28' }, // unparseable → skipped
        { courseCode: 'ZZ ZG000', slotInfo: 'SL1', semesterName: 'Sem-I', programmeCode: 'HT01' }, // not in Dibba → skipped
      ],
      catalogue: [],
      offCampusMaxCourses: 3,
    });
    expect(o.slotDrift).toEqual([
      {
        code: 'SE ZG503',
        title: 'SE ZG503 title',
        dibbaSlots: [2],
        slotInfo: 'Slot 5',
        semesterName: 'Sem-I',
        programmeCode: 'HT01',
      },
    ]);
  });
});

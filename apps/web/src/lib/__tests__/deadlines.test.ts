import { describe, expect, it } from 'vitest';
import { HandoutStatus } from '@hmp/db';
import {
  deadlinesFor,
  currentDeadline,
  daysLeft,
  dueWords,
  formatDueDay,
  type DeadlineConfig,
} from '../deadlines';
import { levelReached } from '../escalation';

const cfg: DeadlineConfig = {
  hogReviewSla: 72,
  pcReviewSla: 72,
  facultySubmitSla: 168,
  hogFinalSla: 48,
  smeReviewSla: 72,
  dueAllocationDays: 35,
  dueDraftDays: 21,
  dueSmeDays: 17,
  duePcDays: 14,
  dueHogFinalDays: 10,
  duePublishDays: 7,
};

// Semester starts 05 Jan 2027 (midnight India time).
const START = new Date('2027-01-04T18:30:00Z');
const at = (iso: string) => new Date(iso);
const day = (d: Date) => formatDueDay(d);

describe('deadlinesFor (v1.4.2 §1)', () => {
  it('plans every stage from the semester start when the request starts early', () => {
    const d = deadlinesFor(
      {
        status: HandoutStatus.REQUESTED,
        stageStartedAt: at('2026-11-01T06:00:00Z'),
        semesterStart: START,
        manual: {},
      },
      cfg,
    );
    expect(d.map((x) => [x.stage, day(x.dueAt), x.state])).toEqual([
      ['ALLOCATION', '01 Dec 2026', 'current'],
      ['DRAFT', '15 Dec 2026', 'later'],
      ['SME_REVIEW', '19 Dec 2026', 'later'],
      ['PC_REVIEW', '22 Dec 2026', 'later'],
      ['HOG_FINAL', '26 Dec 2026', 'later'],
      ['PUBLISH', '29 Dec 2026', 'later'],
    ]);
  });

  it('gives a late request fair time: the stage start + its SLA, and later stages chained', () => {
    // Created 20 Dec — past the planned allocation date (01 Dec).
    const d = deadlinesFor(
      {
        status: HandoutStatus.REQUESTED,
        stageStartedAt: at('2026-12-20T06:00:00Z'),
        semesterStart: START,
        manual: {},
      },
      cfg,
    );
    expect(day(d[0]!.dueAt)).toBe('23 Dec 2026'); // + 72 h
    expect(day(d[1]!.dueAt)).toBe('30 Dec 2026'); // + 168 h after that
    expect(d.every((x, i) => i === 0 || x.dueAt >= d[i - 1]!.dueAt)).toBe(true);
  });

  it('a request sent back gets a fresh draft date by the same rule', () => {
    const d = currentDeadline(
      {
        status: HandoutStatus.REWORK_REQUESTED,
        stageStartedAt: at('2026-12-21T06:00:00Z'),
        semesterStart: START,
        manual: {},
      },
      cfg,
    );
    expect(d?.stage).toBe('DRAFT');
    expect(day(d!.dueAt)).toBe('28 Dec 2026');
  });

  it('a date changed by hand wins, and earlier stages show as done', () => {
    const d = deadlinesFor(
      {
        status: HandoutStatus.SUBMITTED,
        stageStartedAt: at('2026-12-10T06:00:00Z'),
        semesterStart: START,
        manual: {
          PC_REVIEW: {
            dueAt: at('2026-12-30T00:00:00+05:30'),
            reason: 'PC travelling',
            setByName: 'Asha',
          },
        },
      },
      cfg,
    );
    const pc = d.find((x) => x.stage === 'PC_REVIEW')!;
    expect([day(pc.dueAt), pc.source, pc.state, pc.reason]).toEqual([
      '30 Dec 2026',
      'manual',
      'current',
      'PC travelling',
    ]);
    expect(d.filter((x) => x.state === 'done').map((x) => x.stage)).toEqual([
      'ALLOCATION',
      'DRAFT',
      'SME_REVIEW',
    ]);
  });

  it('works without a semester start (SLA only) and has no current stage once published', () => {
    const d = currentDeadline(
      {
        status: HandoutStatus.SME_REVIEW,
        stageStartedAt: at('2026-12-01T06:00:00Z'),
        semesterStart: null,
        manual: {},
      },
      cfg,
    );
    expect(day(d!.dueAt)).toBe('04 Dec 2026');
    expect(
      currentDeadline(
        {
          status: HandoutStatus.PUBLISHED,
          stageStartedAt: at('2026-12-01T06:00:00Z'),
          semesterStart: START,
          manual: {},
        },
        cfg,
      ),
    ).toBeNull();
  });
});

describe('due days are India-time calendar days', () => {
  const due = at('2026-12-12T00:00:00+05:30');
  it('due today until the end of the day, overdue from the next', () => {
    expect(daysLeft(due, at('2026-12-12T23:00:00+05:30'))).toBe(0);
    expect(dueWords(due, at('2026-12-12T23:00:00+05:30')).text).toBe('due today');
    expect(dueWords(due, at('2026-12-13T00:30:00+05:30'))).toEqual({
      text: '1 day overdue',
      tone: 'overdue',
    });
    expect(dueWords(due, at('2026-12-10T10:00:00+05:30'))).toEqual({
      text: '2 days left',
      tone: 'soon',
    });
  });
});

describe('levelReached (escalation ladder, H17 / H26)', () => {
  const on = { escalationOn: true, escalationDays: 3 };
  const off = { escalationOn: false, escalationDays: 3 };
  it('due soon, then overdue to the person', () => {
    expect(levelReached({ left: 3, holderIsHog: false }, on)).toBeNull();
    expect(levelReached({ left: 2, holderIsHog: false }, on)).toBe(0);
    expect(levelReached({ left: 0, holderIsHog: false }, on)).toBe(0);
    expect(levelReached({ left: -1, holderIsHog: false }, on)).toBe(1);
  });
  it('+ HOG after N days, + IC after 2N; a HOG’s own stage goes to the IC at N', () => {
    expect(levelReached({ left: -3, holderIsHog: false }, on)).toBe(2);
    expect(levelReached({ left: -6, holderIsHog: false }, on)).toBe(3);
    expect(levelReached({ left: -9, holderIsHog: true }, on)).toBe(2);
  });
  it('with escalation off, only the reminders to the person', () => {
    expect(levelReached({ left: -10, holderIsHog: false }, off)).toBe(1);
  });
});

import { describe, expect, it, vi } from 'vitest';

// Pure parts of v1.4.2 — no database (the modules' Prisma calls are never reached here).
vi.mock('@hmp/queue', () => ({ enqueueNotification: vi.fn(), enqueueScheduleJob: vi.fn() }));
vi.mock('@hmp/integrations', () => ({ sendMail: vi.fn() }));

import { mentionedIn, type RequestPerson } from '../comment-people';
import { toIcs, type CalendarEvent } from '../calendar';
import { periodKey, reminderText } from '../daily-run';
import { istDay } from '../deadlines';
import type { PlannedStep } from '../escalation';

const people: RequestPerson[] = [
  { id: 'a', name: 'Dr A', role: 'HOG' },
  { id: 'ab', name: 'Dr AB', role: 'PC' },
  { id: 'm', name: 'Meera Iyer', role: 'IC' },
];

describe('mentionedIn (F10, H22)', () => {
  it('finds "@Name" of people on the request, whole names only', () => {
    expect(
      mentionedIn('@Dr AB please check, cc @Meera Iyer.', people)
        .map((p) => p.id)
        .sort(),
    ).toEqual(['ab', 'm']);
    expect(mentionedIn('@Dr A, see below', people).map((p) => p.id)).toEqual(['a']);
  });
  it('ignores names without @, other people, and partial names', () => {
    expect(mentionedIn('Dr A wrote this; @Somebody Else; @Dr ABC', people)).toEqual([]);
  });
  it('is case-insensitive and counts a person once', () => {
    expect(mentionedIn('@dr a … @DR A', people).map((p) => p.id)).toEqual(['a']);
  });
});

describe('toIcs (F9)', () => {
  const day = istDay(new Date('2026-12-12T00:00:00+05:30'));
  const ev: CalendarEvent = {
    uid: 'r1-DRAFT@hmp',
    day,
    summary: 'HMP: Faculty draft — SS ZG653 Software Testing; part 1, part 2',
    description: 'HMP-2026-0001 · Sem-I 2026-27 · now with you',
    url: 'https://hmp.example/faculty/assignments/r1',
  };
  const ics = toIcs([ev], 'HMP deadlines', new Date('2026-11-11T10:00:00Z'));
  it('is an all-day event on the due day, CRLF lines', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('DTSTART;VALUE=DATE:20261212\r\n');
    expect(ics).toContain('DTEND;VALUE=DATE:20261213\r\n');
    expect(ics.split('\r\n').every((l) => !l.includes('\n'))).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });
  // Folded lines continue after CRLF + one space (RFC 5545 §3.1).
  const unfolded = ics.replace(/\r\n /g, '');
  it('escapes commas, semicolons and newlines', () => {
    expect(unfolded).toContain('Software Testing\\; part 1\\, part 2');
    expect(unfolded).toContain('now with you\\nhttps://hmp.example/faculty/assignments/r1');
  });
  it('folds lines longer than 75 bytes', () => {
    const lines = ics.split('\r\n');
    expect(lines.every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
    expect(lines.some((l) => l.startsWith(' '))).toBe(true);
  });
});

describe('daily run (H15, H17)', () => {
  it('one daily key per India-time day; weekly key is that week’s Monday', () => {
    expect(periodKey('daily', new Date('2026-11-11T20:00:00Z'))).toBe('2026-11-12'); // 01:30 IST
    expect(periodKey('weekly', new Date('2026-11-12T04:00:00Z'))).toBe('2026-11-09'); // Thu → Mon
    expect(periodKey('weekly', new Date('2026-11-09T04:00:00Z'))).toBe('2026-11-09'); // Mon
    expect(periodKey('weekly', new Date('2026-11-15T10:00:00Z'))).toBe('2026-11-09'); // Sun
  });

  const step = (level: 0 | 1 | 2 | 3, days: number): PlannedStep => ({
    requestId: 'r1',
    refNo: 'HMP-2026-0001',
    course: 'SS ZG653 Software Testing',
    stage: 'DRAFT',
    stageLabel: 'Faculty draft',
    dueAt: new Date(),
    dueText: '05 Dec 2026',
    daysOverdue: days,
    level,
    holder: 'Dr A',
    told: [],
    holderRole: 'FACULTY',
    holderIds: ['a'],
    hogIds: [],
    toIc: false,
  });
  it('words the reminders and the escalation copy', () => {
    expect(reminderText(step(0, 0), 'holder').subject).toBe(
      'Due soon: SS ZG653 Software Testing — Faculty draft, due 05 Dec 2026',
    );
    expect(reminderText(step(1, 1), 'holder').subject).toContain('Overdue');
    expect(reminderText(step(1, 1), 'holder').subject).toContain('(1 day)');
    const copy = reminderText(step(2, 4), 'copy');
    expect(copy.subject).toBe(
      'Escalation: SS ZG653 Software Testing — Faculty draft 4 days overdue',
    );
    expect(copy.body).toContain('It is with Dr A');
  });
});

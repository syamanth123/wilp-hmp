import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatTime } from './format-date';

describe('formatDate / formatDateTime (India time)', () => {
  it('formats as "05 Dec 2026"', () => {
    expect(formatDate(new Date('2026-12-05T06:00:00Z'))).toBe('05 Dec 2026');
  });

  it('uses India time, not the server zone: 20:00 UTC is the next day in India', () => {
    // 2026-10-29 20:00 UTC = 2026-10-30 01:30 IST
    expect(formatDate(new Date('2026-10-29T20:00:00Z'))).toBe('30 Oct 2026');
    expect(formatDateTime(new Date('2026-10-29T20:00:00Z'))).toBe('30 Oct 2026, 1:30 am');
  });

  it('gives three-letter months, including September', () => {
    expect(formatDate(new Date('2026-09-15T06:00:00Z'))).toBe('15 Sep 2026');
  });

  it('formats times as h:mm am/pm', () => {
    expect(formatTime(new Date('2026-10-29T10:10:00Z'))).toBe('3:40 pm');
    expect(formatTime(new Date('2026-10-29T18:30:00Z'))).toBe('12:00 am');
    expect(formatTime(new Date('2026-10-29T06:30:00Z'))).toBe('12:00 pm');
  });

  it('accepts strings and gives a dash for empty or invalid input', () => {
    expect(formatDate('2026-01-02T00:00:00Z')).toBe('02 Jan 2026');
    expect(formatDate(null)).toBe('—');
    expect(formatDate(undefined)).toBe('—');
    expect(formatDate('not a date')).toBe('—');
    expect(formatDateTime(null, '')).toBe('');
  });
});

import { describe, expect, it } from 'vitest';
import { dueText } from '../due-text';

const NOW = new Date('2026-11-03T06:00:00Z'); // 3 Nov, 11:30 IST
const at = (iso: string) => new Date(iso);

describe('dueText', () => {
  it('overdue, counted in India days', () => {
    expect(dueText(at('2026-11-01T06:00:00Z'), NOW)).toEqual({
      text: 'Overdue by 2 days',
      tone: 'overdue',
    });
    expect(dueText(at('2026-11-02T06:00:00Z'), NOW).text).toBe('Overdue by 1 day');
    // v1.4.2: due "on 3 Nov" means by the end of 3 Nov — not overdue later that day.
    expect(dueText(at('2026-11-03T05:00:00Z'), NOW).text).toBe('Due today');
  });
  it('today, tomorrow, in N days', () => {
    expect(dueText(at('2026-11-03T12:00:00Z'), NOW)).toEqual({ text: 'Due today', tone: 'soon' });
    expect(dueText(at('2026-11-04T12:00:00Z'), NOW).text).toBe('Due tomorrow');
    expect(dueText(at('2026-11-06T12:00:00Z'), NOW)).toEqual({
      text: 'Due in 3 days',
      tone: 'soon',
    });
    expect(dueText(at('2026-11-10T12:00:00Z'), NOW)).toEqual({
      text: 'Due in 7 days',
      tone: 'later',
    });
  });
  it('far away shows the date', () => {
    expect(dueText(at('2026-12-05T06:00:00Z'), NOW).text).toBe('Due 05 Dec 2026');
  });
});

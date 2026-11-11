import { formatDate } from './format-date';

const DAY = 86_400_000;

export interface DueText {
  text: string;
  tone: 'overdue' | 'soon' | 'later';
}

/**
 * The library's Due column in plain words: "Overdue by 2 days", "Due today", "Due in 3 days",
 * and the date itself when it is more than two weeks away. Counted in whole India-time days.
 */
export function dueText(dueAt: Date, now: Date = new Date()): DueText {
  const ist = (d: Date) => Math.floor((d.getTime() + 5.5 * 3_600_000) / DAY);
  const days = ist(dueAt) - ist(now);
  // v1.4.2: a due date is a whole day (lib/deadlines.ts) — overdue from the day after.
  if (days < 0) {
    const late = -days;
    return { text: `Overdue by ${late} ${late === 1 ? 'day' : 'days'}`, tone: 'overdue' };
  }
  if (days === 0) return { text: 'Due today', tone: 'soon' };
  if (days === 1) return { text: 'Due tomorrow', tone: 'soon' };
  if (days <= 14) return { text: `Due in ${days} days`, tone: days <= 3 ? 'soon' : 'later' };
  return { text: `Due ${formatDate(dueAt)}`, tone: 'later' };
}

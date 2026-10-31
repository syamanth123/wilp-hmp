/**
 * The one way dates and times are shown in HMP: "05 Dec 2026" and
 * "05 Dec 2026, 3:40 pm", always in India time.
 *
 * Storage is untouched — the database keeps UTC. Only the display converts,
 * so a server running in UTC (the EC2 pilot) still shows Indian dates and an
 * evening event no longer appears on the previous day.
 */

export const DISPLAY_TIME_ZONE = 'Asia/Kolkata';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const partsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: DISPLAY_TIME_ZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hourCycle: 'h23',
});

type DateInput = Date | string | number | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value == null || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parts(d: Date) {
  const p: Record<string, string> = {};
  for (const { type, value } of partsFmt.formatToParts(d)) p[type] = value;
  return {
    day: Number(p.day),
    month: Number(p.month),
    year: Number(p.year),
    hour: Number(p.hour) % 24,
    minute: p.minute ?? '00',
  };
}

/** "05 Dec 2026" (India time). Empty input gives the fallback (default "—"). */
export function formatDate(value: DateInput, fallback = '—'): string {
  const d = toDate(value);
  if (!d) return fallback;
  const { day, month, year } = parts(d);
  return `${String(day).padStart(2, '0')} ${MONTHS[month - 1]} ${year}`;
}

/** "3:40 pm" (India time). */
export function formatTime(value: DateInput, fallback = '—'): string {
  const d = toDate(value);
  if (!d) return fallback;
  const { hour, minute } = parts(d);
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${minute} ${hour < 12 ? 'am' : 'pm'}`;
}

/** "05 Dec 2026, 3:40 pm" (India time). */
export function formatDateTime(value: DateInput, fallback = '—'): string {
  const d = toDate(value);
  if (!d) return fallback;
  return `${formatDate(d)}, ${formatTime(d)}`;
}

/** Drop-in for an `Intl.DateTimeFormat` used as `fmt.format(date)`: "05 Dec 2026". */
export const dateFormatter = { format: (d: DateInput) => formatDate(d) };
/** Drop-in for an `Intl.DateTimeFormat` used as `fmt.format(date)`: "05 Dec 2026, 3:40 pm". */
export const dateTimeFormatter = { format: (d: DateInput) => formatDateTime(d) };

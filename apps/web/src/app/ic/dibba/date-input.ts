import { z } from 'zod';

/**
 * Date and time input helpers shared by the Course Dibba actions (Phase 3 term
 * create, Phase 4 term edit / class times / exam dates). Plain TypeScript — no
 * 'use server', no server-only imports — so schemas.ts files can unit-test them.
 */

/** Parse `YYYY-MM-DD` as local midnight so the rendered date doesn't slip a day in +UTC zones. */
export function parseDateLocal(s: string): Date {
  const [y, m, d] = s.split('-').map((p) => Number(p));
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

/** The inverse, for `<input type="date" defaultValue>` (local calendar day). */
export function toDateInputValue(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter dates as YYYY-MM-DD')
  .transform(parseDateLocal);

/** `YYYY-MM-DD` or empty (→ null). */
export const isoDateOrEmpty = z
  .string()
  .trim()
  .transform((s) => (s === '' ? null : s))
  .pipe(isoDate.nullable());

/** `HH:MM` (24-hour) or empty (→ null). The semantic pair rules live in the db core. */
export const hhmmOrEmpty = z
  .string()
  .trim()
  .transform((s) => (s === '' ? null : s))
  .pipe(
    z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Times must be HH:MM (24-hour), e.g. 09:00')
      .nullable(),
  );

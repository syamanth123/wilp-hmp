// Dates typed by hand: always day first (dd/mm/yyyy), whatever the browser's language. The value
// stored and sent to the server stays "YYYY-MM-DD".

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const pad = (n: number) => String(n).padStart(2, '0');

export const isoDate = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

function valid(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return null;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d > last ? null : isoDate(y, m, d);
}

/**
 * "05/12/2026", "5-12-2026", "05.12.2026", "05 Dec 2026" and "2026-12-05" → "2026-12-05".
 * Blank → ''. Anything else (or an impossible day such as 31/02/2026) → null.
 */
export function parseDateInput(text: string): string | null {
  const t = text.trim();
  if (!t) return '';
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return valid(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (m) return valid(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{1,2})[\s-]+([A-Za-z]{3})[A-Za-z]*\.?[\s,-]+(\d{4})$/.exec(t);
  if (m) {
    const month = MONTHS.indexOf(m[2]!.toLowerCase()) + 1;
    return month ? valid(Number(m[3]), month, Number(m[1])) : null;
  }
  return null;
}

/** "2026-12-05" → "05/12/2026"; anything else → ''. */
export function formatDateInput(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

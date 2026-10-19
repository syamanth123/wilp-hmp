// Shared formatters for the Course Dibba screens. Explicit locale so the
// rendered strings do not depend on the server's LANG/ICU default — the e2e
// asserts "1,077" and the publish copy repeats the same number.
export const fmtInt = new Intl.NumberFormat('en-IN');
export const fmtDate = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});
export const fmtDateTime = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** Slot label from the stored day/session; slot 0 means "no slot" (dissertation / project). */
export function slotLabel(slotNo: number, day: string | null, session: string | null): string {
  if (slotNo === 0) return 'no slot';
  return day && session ? `SL${slotNo} ${day} ${session}` : `SL${slotNo}`;
}

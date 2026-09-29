/**
 * Standard Course Dibba slot map — the 8 class slots every WILP term uses.
 *
 * Source: Course Dibba spec §1 (docs/course-dibba-schedule.md), measured on the
 * 2025 Word Dibba ("As on 02.07.2025") and the 2024 Excel Dibba. Verified
 * 2026-09-29. Slot 0 ("no slot" — dissertation / project, Excel only) is
 * deliberately NOT a timing row: it is a valid DibbaEntry.slotNo value, nothing
 * more.
 *
 * Pure data — no I/O, no Prisma, no React — so it is importable from the dev
 * seed, the IC create-term action (Phase 3, which seeds SlotTiming rows for a
 * new production term) and the parser (Phase 2). Single source of truth: never
 * re-list these rows elsewhere.
 */

export type SlotDay = 'SAT' | 'SUN' | 'FRI';
export type SlotSession = 'FN' | 'AN' | 'EV';

export interface StandardSlot {
  slotNo: number;
  day: SlotDay;
  session: SlotSession;
  label: string;
}

export const STANDARD_SLOTS: readonly StandardSlot[] = [
  { slotNo: 1, day: 'SAT', session: 'FN', label: 'Saturday forenoon' },
  { slotNo: 2, day: 'SAT', session: 'AN', label: 'Saturday afternoon' },
  { slotNo: 3, day: 'SUN', session: 'FN', label: 'Sunday forenoon' },
  { slotNo: 4, day: 'SUN', session: 'AN', label: 'Sunday afternoon' },
  { slotNo: 5, day: 'FRI', session: 'FN', label: 'Friday forenoon' },
  { slotNo: 6, day: 'FRI', session: 'AN', label: 'Friday afternoon' },
  { slotNo: 7, day: 'SAT', session: 'EV', label: 'Saturday evening' },
  { slotNo: 8, day: 'SUN', session: 'EV', label: 'Sunday evening' },
];

/**
 * (day, session) → slot number, for parsing Dibba column headers that name the
 * weekday/session without an "SLn" prefix (Phase 2). Returns undefined for a
 * pair that is not a standard slot (e.g. FRI/EV).
 */
export function standardSlotNo(day: SlotDay, session: SlotSession): number | undefined {
  return STANDARD_SLOTS.find((s) => s.day === day && s.session === session)?.slotNo;
}

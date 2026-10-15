import { z } from 'zod';
import { hhmmOrEmpty, isoDateOrEmpty } from '../../../date-input';

/**
 * Form → typed input for the slots page (Phase 4, plan D4/D5). Shape only
 * (HH:MM / YYYY-MM-DD or empty); the pair and window rules are enforced once,
 * in the db core (validateClassTime, examDateWindow), so the two layers can
 * never disagree. Plain TypeScript, unit-tested.
 */

export const SLOT_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
export const EXAM_KINDS = ['MID_SEM', 'COMPREHENSIVE'] as const;
export type ExamKindInput = (typeof EXAM_KINDS)[number];

export const classTimeRowSchema = z.object({
  slotNo: z.number().int().min(1).max(8),
  startTime: hhmmOrEmpty,
  endTime: hhmmOrEmpty,
});

export const examDateRowSchema = z.object({
  slotNo: z.number().int().min(1).max(8),
  kind: z.enum(EXAM_KINDS),
  date: isoDateOrEmpty,
  startTime: hhmmOrEmpty,
  endTime: hhmmOrEmpty,
});

const str = (v: FormDataEntryValue | null): string => (typeof v === 'string' ? v : '');

/** Field names: `start-{n}`, `end-{n}` for n = 1..8. */
export function classTimesFromForm(fd: FormData) {
  return z.array(classTimeRowSchema).safeParse(
    SLOT_NUMBERS.map((slotNo) => ({
      slotNo,
      startTime: str(fd.get(`start-${slotNo}`)),
      endTime: str(fd.get(`end-${slotNo}`)),
    })),
  );
}

/** Field names: `exam-{n}-{KIND}-date|start|end`. */
export function examDatesFromForm(fd: FormData) {
  return z.array(examDateRowSchema).safeParse(
    SLOT_NUMBERS.flatMap((slotNo) =>
      EXAM_KINDS.map((kind) => ({
        slotNo,
        kind,
        date: str(fd.get(`exam-${slotNo}-${kind}-date`)),
        startTime: str(fd.get(`exam-${slotNo}-${kind}-start`)),
        endTime: str(fd.get(`exam-${slotNo}-${kind}-end`)),
      })),
    ),
  );
}

/**
 * One readable sentence from a zod failure, naming the slot. The arrays above
 * are slot-major: 1 row per slot for class times, 2 (one per kind) for exam dates.
 */
export function firstIssueMessage(
  issues: z.ZodIssue[],
  fallback: string,
  rowsPerSlot: 1 | 2 = 1,
): string {
  const issue = issues[0];
  if (!issue) return fallback;
  const index = typeof issue.path[0] === 'number' ? issue.path[0] : null;
  const slot = index === null ? undefined : SLOT_NUMBERS[Math.floor(index / rowsPerSlot)];
  return slot === undefined ? issue.message : `Slot ${slot}: ${issue.message}`;
}

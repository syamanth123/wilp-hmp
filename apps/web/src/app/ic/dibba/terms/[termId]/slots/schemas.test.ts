import { describe, it, expect } from 'vitest';
import { classTimesFromForm, examDatesFromForm, firstIssueMessage } from './schemas';

const form = (entries: Record<string, string>): FormData => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
};

describe('classTimesFromForm', () => {
  it('reads all 8 slots, mapping empty strings to null', () => {
    const r = classTimesFromForm(form({ 'start-1': '09:00', 'end-1': '12:00', 'start-3': ' ' }));
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data).toHaveLength(8);
    expect(r.data[0]).toEqual({ slotNo: 1, startTime: '09:00', endTime: '12:00' });
    expect(r.data[2]).toEqual({ slotNo: 3, startTime: null, endTime: null });
    expect(r.data[7]!.slotNo).toBe(8);
  });

  it('rejects a malformed time and names the slot', () => {
    const r = classTimesFromForm(form({ 'start-4': '9:00', 'end-4': '12:00' }));
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(firstIssueMessage(r.error.issues, 'x')).toBe(
      'Slot 4: Times must be HH:MM (24-hour), e.g. 09:00',
    );
  });

  it('leaves the pair rule (both-or-neither, order) to the db core', () => {
    expect(classTimesFromForm(form({ 'start-1': '12:00', 'end-1': '09:00' })).success).toBe(true);
    expect(classTimesFromForm(form({ 'start-1': '12:00' })).success).toBe(true);
  });
});

describe('examDatesFromForm', () => {
  it('reads 16 rows (8 slots × 2 kinds) with local-midnight dates', () => {
    const r = examDatesFromForm(
      form({
        'exam-2-MID_SEM-date': '2030-10-05',
        'exam-2-MID_SEM-start': '10:00',
        'exam-2-MID_SEM-end': '12:00',
      }),
    );
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data).toHaveLength(16);
    const row = r.data.find((d) => d.slotNo === 2 && d.kind === 'MID_SEM')!;
    expect(row.date).toEqual(new Date(2030, 9, 5));
    expect(row.startTime).toBe('10:00');
    expect(r.data.find((d) => d.slotNo === 2 && d.kind === 'COMPREHENSIVE')!.date).toBeNull();
  });

  it('rejects a malformed date and names the slot', () => {
    const r = examDatesFromForm(form({ 'exam-5-COMPREHENSIVE-date': '05/10/2030' }));
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(firstIssueMessage(r.error.issues, 'x', 2)).toMatch(/^Slot 5: Enter dates as YYYY-MM-DD/);
  });
});

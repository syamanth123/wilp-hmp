import { describe, it, expect } from 'vitest';
import { STANDARD_SLOTS, standardSlotNo } from '../dibba-slots';

// Pure-data guard for the single source of truth the dev seed and (later) the
// IC create-term action + Dibba parser all import. No Prisma, no I/O.
describe('STANDARD_SLOTS', () => {
  it('has exactly the 8 standard slots numbered 1..8, each once', () => {
    expect(STANDARD_SLOTS).toHaveLength(8);
    expect(STANDARD_SLOTS.map((s) => s.slotNo).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
  });

  it('uses only the SAT/SUN/FRI × FN/AN/EV vocabulary, with no duplicate (day, session) pair', () => {
    const days = new Set(['SAT', 'SUN', 'FRI']);
    const sessions = new Set(['FN', 'AN', 'EV']);
    const pairs = new Set<string>();
    for (const s of STANDARD_SLOTS) {
      expect(days.has(s.day)).toBe(true);
      expect(sessions.has(s.session)).toBe(true);
      expect(s.label.length).toBeGreaterThan(0);
      pairs.add(`${s.day}/${s.session}`);
    }
    expect(pairs.size).toBe(8);
  });

  it('matches the spec §1 map exactly', () => {
    const map = Object.fromEntries(STANDARD_SLOTS.map((s) => [s.slotNo, `${s.day} ${s.session}`]));
    expect(map).toEqual({
      1: 'SAT FN',
      2: 'SAT AN',
      3: 'SUN FN',
      4: 'SUN AN',
      5: 'FRI FN',
      6: 'FRI AN',
      7: 'SAT EV',
      8: 'SUN EV',
    });
  });

  it('standardSlotNo round-trips every slot and rejects a non-standard pair', () => {
    for (const s of STANDARD_SLOTS) {
      expect(standardSlotNo(s.day, s.session)).toBe(s.slotNo);
    }
    expect(standardSlotNo('FRI', 'EV')).toBeUndefined();
  });
});

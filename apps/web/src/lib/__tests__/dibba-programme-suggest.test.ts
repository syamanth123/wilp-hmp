import { describe, expect, it } from 'vitest';
import { suggestProgramme } from '../dibba-programme-codes';

const HMP = [
  { code: 'MTECH-SE', name: 'M.Tech Software Engineering' },
  { code: 'MTECH-DS', name: 'M.Tech Data Science' },
  { code: 'MBA-WILP', name: 'MBA (WILP)' },
  { code: 'MBA-FIN', name: 'MBA Finance' },
  { code: 'BTECH-ET', name: 'B.Tech. Engineering Technology' },
];
const pick = (title: string) => suggestProgramme(title, HMP)?.programme.code ?? null;

describe('suggesting an HMP programme for a Dibba code, by name', () => {
  it('same degree and subject', () => {
    expect(pick('M.Tech. (Software Engineering)')).toBe('MTECH-SE');
    expect(pick('M.Tech. (Data Science & Engineering)')).toBe('MTECH-DS');
    expect(pick('MBA (Finance)')).toBe('MBA-FIN');
    expect(pick('B.Tech. (Engineering Technology)')).toBe('BTECH-ET');
  });
  it('a close subject is still offered (Admin decides)', () => {
    expect(pick('M.Tech. (Software Systems)')).toBe('MTECH-SE');
  });
  it('never across degrees, and never on noise words alone', () => {
    expect(pick('M.Sc. (Software Engineering)')).toBeNull();
    expect(pick('MBA (Hospital & Health Systems Management)')).toBeNull(); // "MBA (WILP)" says nothing
    expect(
      pick(
        'M.Tech. (Sanitation Science, Technology & Management) (No Admission from last 3 semesters) No Batch',
      ),
    ).toBeNull();
    expect(pick('M.Tech. (VLSI Design and Microelectronics)')).toBeNull();
    // Sharing only a generic word ("engineering") is not a match.
    expect(pick('M.Tech. (Environment Engineering)')).toBeNull();
    expect(pick('M.Tech. (Design Engineering)')).toBeNull();
    expect(pick('MBA (Quality Management)')).toBeNull();
  });
});

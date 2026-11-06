import { describe, expect, it } from 'vitest';
import { suggestDepartmentForTitle, suggestionText, tallyDepartments } from '../departments';

const DEPTS = [
  { id: 'm', code: 'MBA', name: 'MBA / Management' },
  { id: 'c', code: 'CORE', name: 'Core Engineering' },
  { id: 's', code: 'CSIS', name: 'CSIS' },
  { id: 'e', code: 'EEE', name: 'EEE' },
];
const code = (title: string) => suggestDepartmentForTitle(title, DEPTS)?.code ?? null;

describe('suggestDepartmentForTitle (real Course Dibba programme titles)', () => {
  it.each([
    ['HB59 MBA (Finance)', 'MBA'],
    ['MB26 MBA (AI FOR BUSINESS)', 'MBA'],
    ['HB74 MBA (Quality Management)', 'MBA'],
    ['PD53 PG Diploma (FinTech)', 'MBA'],
    ['MC21 M.Sc. (Business Analytics)', 'MBA'],
    ['HT15 M.Tech. (Software Systems)', 'CSIS'],
    ['MT03 M.Tech. (Cloud Computing)', 'CSIS'],
    ['MC19 M.Sc. (Information System)', 'CSIS'],
    ['20AI B.Tech. (Artificial Intelligence and Machine Learning)', 'CSIS'],
    ['HT66 M.Tech. (Computing Systems & Infrastructure)', 'CSIS'],
    ['HT08 M.Tech. (VLSI Design and Microelectronics)', 'EEE'],
    ['HT01 M.Tech. (Embedded System)', 'EEE'],
    ['HT65 M.Tech. (Automotive Electronics)', 'EEE'],
    ['35AT B.Tech. (Power Engineering)', 'EEE'],
    ['29EE B. Tech. (Electronics Engineering)', 'EEE'],
    ['HT30 M.Tech. (Design Engineering)', 'CORE'],
    ['HT74 M.Tech. (Quality Management)', 'CORE'],
    ['HT84 M.Tech. (Pharmaceutical Operation & Management)', 'CORE'],
    ['HT 31 M.Tech. Structural Engineering', 'CORE'],
    ['18BT/18ET B.Tech. (Engineering Technology)', 'CORE'],
  ])('%s → %s', (title, expected) => {
    expect(code(title)).toBe(expected);
  });

  it('suggests nothing for a title it cannot place, or when the department does not exist', () => {
    expect(code('Some Other Programme')).toBeNull();
    expect(
      suggestDepartmentForTitle(
        'HB59 MBA (Finance)',
        DEPTS.filter((d) => d.code !== 'MBA'),
      ),
    ).toBeNull();
  });
});

describe('tallyDepartments', () => {
  const names = new Map(DEPTS.map((d) => [d.id, d.code]));

  it('one department across every known course → a suggestion with the course count', () => {
    expect(tallyDepartments([['s'], ['s'], [], ['s']], names)).toEqual({
      kind: 'one',
      departmentId: 's',
      departmentName: 'CSIS',
      courses: 3,
    });
  });

  it('several departments → mixed (no suggestion), largest first', () => {
    const t = tallyDepartments([['s'], ['e'], ['s'], ['s'], ['e']], names);
    expect(t).toEqual({
      kind: 'mixed',
      breakdown: [
        { departmentId: 's', departmentName: 'CSIS', courses: 3 },
        { departmentId: 'e', departmentName: 'EEE', courses: 2 },
      ],
    });
    expect(suggestionText(t)).toBe('Needs a decision: 3 CSIS, 2 EEE');
  });

  it('a course offered in two departments makes the history mixed', () => {
    expect(tallyDepartments([['s', 'm']], names).kind).toBe('mixed');
  });

  it('no course with a known department → none', () => {
    expect(tallyDepartments([[], []], names)).toEqual({ kind: 'none', courses: 2 });
    expect(suggestionText({ kind: 'none', courses: 2 })).toBe(
      '2 past courses, none in a programme with a department yet',
    );
    expect(suggestionText(undefined)).toBe('No past courses in HMP');
  });

  it('wording of a suggestion', () => {
    expect(
      suggestionText({ kind: 'one', departmentId: 's', departmentName: 'CSIS', courses: 1 }),
    ).toBe('CSIS (from 1 past course)');
  });
});

import { describe, expect, it } from 'vitest';
import { matchProgramme, planMessage, planOffering, type PlanInput } from '../dibba-offering';

const row = (code: string, programmeCode: string, o: Partial<PlanInput['rows'][number]> = {}) => ({
  code,
  title: 'ENGINEERING MATERIALS',
  programmeCode,
  slotNo: 1,
  slotDay: 'SAT',
  slotSession: 'FN',
  catalogueTitle: null,
  ...o,
});

const SEM = { id: 'sem-18et', name: 'Sem-I 2025-26', year: 2025, term: 'FIRST' };

const input = (o: Partial<PlanInput> = {}): PlanInput => ({
  codes: ['ET ZC232', 'ENGG ZC232'],
  year: 2025,
  term: 'FIRST',
  rows: [row('ET ZC232', '18BT/18ET'), row('ENGG ZC232', '23NT')],
  programmes: [{ id: 'p-18et', code: '18ET', active: true, semesters: [SEM] }],
  links: {},
  courses: [],
  offerings: [],
  semesterName: 'Sem-I 2025-26',
  ...o,
});

describe('Create request from the Course Dibba — the plan', () => {
  it('offering created: adds the course and offers it in the programme’s existing semester', () => {
    const plan = planOffering(input());
    expect(plan).toMatchObject({
      kind: 'ready',
      codes: ['ET ZC232', 'ENGG ZC232'],
      title: 'Engineering Materials',
      course: null,
      newCourseCodes: ['ET ZC232', 'ENGG ZC232'],
      choices: [
        {
          programmeId: 'p-18et',
          programmeCode: '18ET',
          dibbaProgramme: '18BT/18ET',
          semesterId: 'sem-18et',
          offeringId: null,
        },
      ],
      notSetUp: ['23NT'],
      mixedNumbers: false,
      slotInfo: 'Slot 1 · Sat FN',
    });
  });

  it('offering exists: reuses the catalogue course and its offering, changing nothing', () => {
    const course = {
      id: 'c1',
      bitsCourseNumber: 'ET ZC232',
      code: 'ET ZC232',
      alternateCodes: [],
      title: 'Engineering Materials',
    };
    const plan = planOffering(
      input({
        courses: [course],
        offerings: [{ id: 'o1', courseId: 'c1', semesterId: 'sem-18et' }],
      }),
    );
    expect(plan).toMatchObject({
      kind: 'ready',
      course,
      newCourseCodes: [],
      choices: [{ offeringId: 'o1' }],
    });
  });

  it('semester missing: never invents one; says which programme to set up', () => {
    const plan = planOffering(
      input({ programmes: [{ id: 'p-18et', code: '18ET', active: true, semesters: [] }] }),
    );
    expect(plan).toMatchObject({
      kind: 'not-set-up',
      unlinked: ['23NT'],
      noSemester: ['18BT/18ET'],
    });
    expect(planMessage(plan as never)).toBe(
      "Programme code 23NT isn't linked to an HMP programme yet — ask Admin (Admin → Dibba programme codes). Sem-I 2025-26 isn't set up for programme 18BT/18ET yet — ask Admin to add it.",
    );
  });

  it('a programme HMP doesn’t have counts as not set up', () => {
    expect(planOffering(input({ programmes: [] }))).toMatchObject({
      kind: 'not-set-up',
      unlinked: ['18BT/18ET', '23NT'],
    });
  });

  it('codes not in the published Dibba for that term are refused', () => {
    expect(planOffering(input({ rows: [] }))).toMatchObject({ kind: 'not-in-dibba' });
  });

  it('a project code can’t become a catalogue course automatically', () => {
    const plan = planOffering(
      input({ codes: ['SS ZG628T'], rows: [row('SS ZG628T', '18BT/18ET', { slotNo: 0 })] }),
    );
    expect(plan).toMatchObject({ kind: 'invalid-code', code: 'SS ZG628T' });
  });

  it('flags different course numbers, and keeps non-standard codes off the new course', () => {
    const plan = planOffering(
      input({
        codes: ['ET ZC232', 'POWAB ZC234'],
        rows: [row('ET ZC232', '18BT/18ET'), row('POWAB ZC234', '18BT/18ET')],
      }),
    );
    expect(plan).toMatchObject({
      kind: 'ready',
      mixedNumbers: true,
      newCourseCodes: ['ET ZC232'],
      skippedCodes: ['POWAB ZC234'],
    });
  });

  describe('which HMP programme a Dibba code means', () => {
    const ps = [
      { id: 'a', code: 'HT15', active: true, semesters: [] },
      { id: 'b', code: '18et', active: true, semesters: [] },
      { id: 'c', code: 'MTECH-SE', active: true, semesters: [] },
      { id: 'd', code: 'OLD-PROG', active: false, semesters: [] },
    ];
    it('exact code match, whole or one "/" part, without any link', () => {
      expect(matchProgramme('HT15', { programmes: ps, links: {} })?.id).toBe('a');
      expect(matchProgramme('18BT/18ET', { programmes: ps, links: {} })?.id).toBe('b');
      expect(matchProgramme('MB21/HB21', { programmes: ps, links: {} })).toBeNull();
    });
    it("Admin's link wins over a matching code", () => {
      expect(matchProgramme('HT15', { programmes: ps, links: { HT15: 'c' } })?.id).toBe('c');
      expect(matchProgramme('MB21/HB21', { programmes: ps, links: { 'MB21/HB21': 'c' } })?.id).toBe(
        'c',
      );
    });
    it('an inactive programme is never used, linked or not', () => {
      expect(
        matchProgramme('MB21/HB21', { programmes: ps, links: { 'MB21/HB21': 'd' } }),
      ).toBeNull();
      expect(matchProgramme('OLD-PROG', { programmes: ps, links: {} })).toBeNull();
    });
    it('an unlinked code makes the plan say "ask Admin (Admin → Dibba programme codes)"', () => {
      const plan = planOffering(input({ programmes: [] }));
      expect(planMessage(plan as never)).toBe(
        "Programme codes 18BT/18ET, 23NT aren't linked to an HMP programme yet — ask Admin (Admin → Dibba programme codes).",
      );
    });
    it('a linked code is offered in its programme’s semester', () => {
      const plan = planOffering(
        input({
          programmes: [{ id: 'p-mt', code: 'MTECH-ET', active: true, semesters: [SEM] }],
          links: { '23NT': 'p-mt' },
        }),
      );
      expect(plan).toMatchObject({
        kind: 'ready',
        choices: [{ programmeCode: 'MTECH-ET', dibbaProgramme: '23NT' }],
        notSetUp: ['18BT/18ET'],
      });
    });
  });
});

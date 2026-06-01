import { describe, it, expect } from 'vitest';
import { ecSumWeight, evaluationTotalWeight, isEvaluationValid } from '../evaluation-validity';
import type { BitsHandoutV1 } from '@hmp/db';

type Eval = BitsHandoutV1['evaluation'];

const empty: Eval = {
  legend: '',
  components: [],
  notes: '',
  midSemSyllabus: '',
  compreSyllabus: '',
};

function withComponents(components: Eval['components']): Eval {
  return { ...empty, components };
}

describe('evaluation-validity — totals math', () => {
  it('empty evaluation totals 0 and is invalid (not 100)', () => {
    expect(evaluationTotalWeight(empty)).toBe(0);
    expect(isEvaluationValid(empty)).toBe(false);
  });

  it('single EC with one sub-component at 100 is valid', () => {
    const ev = withComponents([
      {
        ecNumber: 'EC-1',
        subComponents: [{ name: 'Exam', type: 'Closed', weight: 100, duration: '2h' }],
      },
    ]);
    expect(evaluationTotalWeight(ev)).toBe(100);
    expect(isEvaluationValid(ev)).toBe(true);
  });

  it('sums sub-component weights within an EC', () => {
    const ec = {
      ecNumber: 'EC-1',
      subComponents: [
        { name: 'Quiz', type: 'Online', weight: 10, duration: '30m' },
        { name: 'Virtual lab', type: 'Online', weight: 20, duration: '' },
      ],
    };
    expect(ecSumWeight(ec)).toBe(30);
  });

  it('sums across multiple ECs', () => {
    const ev = withComponents([
      {
        ecNumber: 'EC-1',
        subComponents: [
          { name: 'Quiz', type: 'Online', weight: 10, duration: '' },
          { name: 'Lab', type: 'Online', weight: 20, duration: '' },
        ],
      },
      {
        ecNumber: 'EC-2',
        subComponents: [{ name: 'Mid-Sem', type: 'Closed', weight: 30, duration: '2h' }],
      },
      {
        ecNumber: 'EC-3',
        subComponents: [{ name: 'Compre', type: 'Open', weight: 40, duration: '2.5h' }],
      },
    ]);
    expect(evaluationTotalWeight(ev)).toBe(100);
    expect(isEvaluationValid(ev)).toBe(true);
  });

  it('returns the exact total when ≠ 100 — needed for the "X% short / over" message', () => {
    const ev = withComponents([
      {
        ecNumber: 'EC-1',
        subComponents: [{ name: 'X', type: 'Online', weight: 95, duration: '' }],
      },
    ]);
    expect(evaluationTotalWeight(ev)).toBe(95);
    expect(isEvaluationValid(ev)).toBe(false);
  });

  it('treats NaN weight as 0 (defensive against bad form state)', () => {
    const ev = withComponents([
      {
        ecNumber: 'EC-1',
        subComponents: [
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { name: 'Bad', type: 'X', weight: NaN as any, duration: '' },
          { name: 'Good', type: 'X', weight: 100, duration: '' },
        ],
      },
    ]);
    expect(evaluationTotalWeight(ev)).toBe(100);
    expect(isEvaluationValid(ev)).toBe(true);
  });

  it('over-100 fails validity (must equal 100, not just ≤ 100)', () => {
    const ev = withComponents([
      {
        ecNumber: 'EC-1',
        subComponents: [{ name: 'X', type: 'Online', weight: 60, duration: '' }],
      },
      {
        ecNumber: 'EC-2',
        subComponents: [{ name: 'Y', type: 'Online', weight: 60, duration: '' }],
      },
    ]);
    expect(evaluationTotalWeight(ev)).toBe(120);
    expect(isEvaluationValid(ev)).toBe(false);
  });
});

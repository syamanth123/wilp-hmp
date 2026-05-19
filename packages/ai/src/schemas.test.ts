import { describe, it, expect } from 'vitest';
import { QualityReportSchema, BloomsBucketSchema } from './schemas';

const validBlooms = {
  remember: 0.2,
  understand: 0.2,
  apply: 0.2,
  analyze: 0.2,
  evaluate: 0.1,
  create: 0.1,
};

describe('QualityReportSchema', () => {
  it('accepts a well-formed report', () => {
    const parsed = QualityReportSchema.parse({
      score: 0.75,
      blooms: validBlooms,
      coverage: { covered: ['Patterns'], missing: ['Microservices'], coverageRatio: 0.5 },
      suggestions: 'Add more apply-level activities.',
    });
    expect(parsed.score).toBe(0.75);
  });

  it('rejects score outside [0,1]', () => {
    expect(() =>
      QualityReportSchema.parse({
        score: 1.5,
        blooms: validBlooms,
        coverage: { covered: [], missing: [], coverageRatio: 0 },
        suggestions: '',
      }),
    ).toThrow();
  });

  it('rejects extra unknown keys (strict)', () => {
    expect(() =>
      QualityReportSchema.parse({
        score: 0.5,
        blooms: validBlooms,
        coverage: { covered: [], missing: [], coverageRatio: 0 },
        suggestions: '',
        extra: 'nope',
      }),
    ).toThrow();
  });
});

describe('BloomsBucketSchema', () => {
  it('rejects negative values', () => {
    expect(() =>
      BloomsBucketSchema.parse({ ...validBlooms, remember: -0.1 }),
    ).toThrow();
  });

  it('rejects missing levels', () => {
    const { remember: _r, ...rest } = validBlooms;
    expect(() => BloomsBucketSchema.parse(rest)).toThrow();
  });
});

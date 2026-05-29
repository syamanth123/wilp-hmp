import { describe, it, expect } from 'vitest';
import { normalizeBitsCourseNumber, bitsCourseNumberSchema, getDiscipline } from '../course-code';

describe('normalizeBitsCourseNumber — canonical / well-formed inputs', () => {
  it('passes already-canonical strings through unchanged', () => {
    expect(normalizeBitsCourseNumber('MBA ZC415')).toBe('MBA ZC415');
    expect(normalizeBitsCourseNumber('SE ZG501')).toBe('SE ZG501');
    expect(normalizeBitsCourseNumber('AEL ZC442')).toBe('AEL ZC442');
    expect(normalizeBitsCourseNumber('MATH ZC222')).toBe('MATH ZC222');
    expect(normalizeBitsCourseNumber('BTEE ZC211')).toBe('BTEE ZC211');
  });
});

describe('normalizeBitsCourseNumber — real-world irregularities (survey-derived)', () => {
  it('joins "MBAZG501" → "MBA ZG501" (no-space transcription)', () => {
    expect(normalizeBitsCourseNumber('MBAZG501')).toBe('MBA ZG501');
  });
  it('joins "ETZC235" → "ET ZC235"', () => {
    expect(normalizeBitsCourseNumber('ETZC235')).toBe('ET ZC235');
  });
  it('joins "POM ZG 512" → "POM ZG512" (run-split extra space)', () => {
    expect(normalizeBitsCourseNumber('POM ZG 512')).toBe('POM ZG512');
  });
  it('joins "ST ZG55 1" → "ST ZG551" (mid-digit run-split)', () => {
    expect(normalizeBitsCourseNumber('ST ZG55 1')).toBe('ST ZG551');
  });
  it('uppercases lowercase input ("mba zc415" → "MBA ZC415")', () => {
    expect(normalizeBitsCourseNumber('mba zc415')).toBe('MBA ZC415');
  });
});

describe('normalizeBitsCourseNumber — invalid inputs (educational rejection)', () => {
  it('throws on empty string (Decision 3 test case)', () => {
    expect(() => normalizeBitsCourseNumber('')).toThrow(/empty string/);
  });
  it('throws on whitespace-only', () => {
    expect(() => normalizeBitsCourseNumber('   ')).toThrow(/empty string/);
  });
  it('throws on lowercase garbage "abc" (Decision 3 test case)', () => {
    expect(() => normalizeBitsCourseNumber('abc')).toThrow(/Not a valid BITS course number/);
  });
  it('throws on pure digits "12345" (Decision 3 test case)', () => {
    expect(() => normalizeBitsCourseNumber('12345')).toThrow(/Not a valid BITS course number/);
  });
  it('throws on the legacy invented form "SE-ZG501" (hyphen-separated)', () => {
    expect(() => normalizeBitsCourseNumber('SE-ZG501')).toThrow(/Not a valid BITS course number/);
  });
  it('throws on too-long discipline prefix (5 letters)', () => {
    expect(() => normalizeBitsCourseNumber('ABCDE ZC100')).toThrow(
      /Not a valid BITS course number/,
    );
  });
  it('throws on too-long course digits (5)', () => {
    expect(() => normalizeBitsCourseNumber('AE ZG12345')).toThrow(/Not a valid BITS course number/);
  });
  it('throws on too-short course digits (2)', () => {
    expect(() => normalizeBitsCourseNumber('AE ZG12')).toThrow(/Not a valid BITS course number/);
  });
  it('throws on wrong campus marker ("ZX")', () => {
    expect(() => normalizeBitsCourseNumber('AE ZX631')).toThrow(/Not a valid BITS course number/);
  });
  it('rejection messages include the canonical example for the user (educational)', () => {
    try {
      normalizeBitsCourseNumber('SE-ZG501');
      throw new Error('expected throw');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('AE ZG510');
      expect(msg).toContain('SE-ZG501');
    }
  });
});

describe('normalizeBitsCourseNumber — max-bounds canonical (Decision 3 test case)', () => {
  it('accepts "XYZW ZC9999" (4-letter prefix, 4-digit number — schema max)', () => {
    expect(normalizeBitsCourseNumber('XYZW ZC9999')).toBe('XYZW ZC9999');
  });
  it('accepts "AE ZG100" (2-letter prefix, 3-digit number — schema min)', () => {
    expect(normalizeBitsCourseNumber('AE ZG100')).toBe('AE ZG100');
  });
});

describe('bitsCourseNumberSchema (strict post-normalization gate)', () => {
  it('accepts canonical form', () => {
    expect(bitsCourseNumberSchema.safeParse('MBA ZC415').success).toBe(true);
  });
  it('rejects joined form "MBAZG501" (must normalize first)', () => {
    expect(bitsCourseNumberSchema.safeParse('MBAZG501').success).toBe(false);
  });
  it('rejects extra-spaced "POM ZG 512" (must normalize first)', () => {
    expect(bitsCourseNumberSchema.safeParse('POM ZG 512').success).toBe(false);
  });
  it('rejects lowercase (must normalize first)', () => {
    expect(bitsCourseNumberSchema.safeParse('mba zc415').success).toBe(false);
  });
});

describe('getDiscipline', () => {
  it('returns the canonical prefix (first whitespace-delimited token)', () => {
    expect(getDiscipline({ bitsCourseNumber: 'MBA ZC417' })).toBe('MBA');
    expect(getDiscipline({ bitsCourseNumber: 'AE ZG631' })).toBe('AE');
    expect(getDiscipline({ bitsCourseNumber: 'AEL ZC442' })).toBe('AEL');
    expect(getDiscipline({ bitsCourseNumber: 'MATH ZC222' })).toBe('MATH');
  });
  it('throws on a malformed bitsCourseNumber (empty)', () => {
    expect(() => getDiscipline({ bitsCourseNumber: '' })).toThrow(/malformed/);
  });
});

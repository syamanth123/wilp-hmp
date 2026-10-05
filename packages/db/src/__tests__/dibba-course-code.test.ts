import { describe, it, expect } from 'vitest';
import {
  normalizeBitsCourseNumber,
  normalizeDibbaCourseCode,
  findDibbaCourseCodes,
} from '../course-code';

// Course Dibba Phase 2. The lenient normalizer exists BECAUSE the strict one
// rejects trailing-T and 5-letter-prefix codes by design — the first describe
// pins that contract so nobody "fixes" the strict one to make Dibba parsing
// easier.
describe('normalizeBitsCourseNumber stays strict (unchanged by Phase 2)', () => {
  it.each(['ABCDE ZC100', 'SS ZG628T', 'BITS ZC425T', 'POWAB ZC113'])(
    'still rejects %s',
    (code) => {
      expect(() => normalizeBitsCourseNumber(code)).toThrow(/Not a valid BITS course number/);
    },
  );
});

describe('normalizeDibbaCourseCode', () => {
  it.each([
    ['SSZG628T', 'SS ZG628T'], // joined + trailing T (dissertation)
    ['BITS ZC425T', 'BITS ZC425T'], // 4-letter prefix + T (project work)
    ['mba zg622t', 'MBA ZG622T'], // lowercase
    ['EEE ZG 571', 'EEE ZG571'], // split digits
    ['POWAB ZC113', 'POWAB ZC113'], // 5-letter prefix
    ['MBA    ZG527', 'MBA ZG527'], // many spaces
    ['AE ZG631', 'AE ZG631'], // already canonical, no T
    ['ST ZG55 1', 'ST ZG551'], // mid-digit split (same quirk the strict one handles)
  ])('%s → %s', (input, expected) => {
    expect(normalizeDibbaCourseCode(input)).toBe(expected);
  });

  it.each(['ABCDEF ZC100', 'SE-ZG501', 'ZG501', 'AE ZG63', '', 'AE XG631'])('rejects %s', (bad) => {
    expect(() => normalizeDibbaCourseCode(bad)).toThrow(/Not a valid Dibba course code/);
  });
});

describe('findDibbaCourseCodes (free-text cell scan)', () => {
  it('ignores an ERP course-id prefix and finds the real code', () => {
    const found = findDibbaCourseCodes('1. 504303|IS ZC364|OPERATING SYSTEMS 2. 502222|');
    expect(found.map((f) => f.code)).toEqual(['IS ZC364']);
  });

  it('finds every code in a multi-course cell, in order, with offsets usable for title slicing', () => {
    const cell = 'ET ZC232|ENGINEERING MATERIALS\nENGGZC232|ENGINEERING MATERIALS (CORE)';
    const found = findDibbaCourseCodes(cell);
    expect(found.map((f) => f.code)).toEqual(['ET ZC232', 'ENGG ZC232']);
    expect(cell.slice(found[0]!.end, found[1]!.start)).toBe('|ENGINEERING MATERIALS\n');
  });

  it.each([
    ['EEE ZG 571|OPTICAL COMMUNICATIONS', ['EEE ZG571']],
    ['MBA    ZG527|ENTREPRENEURSHIP', ['MBA ZG527']],
    ['SSZG628T|DISSERTATION', ['SS ZG628T']],
    ['BTEEZC216 : PROB. THEORY (CORE)', ['BTEE ZC216']],
    ['POW ZC113| Electrical & Electronics Tech (CORE)', ['POW ZC113']],
  ])('%s → %j', (cell, codes) => {
    expect(findDibbaCourseCodes(cell).map((f) => f.code)).toEqual(codes);
  });

  it('returns [] for a cell with no code (the parser turns this into a warning, never drops it silently)', () => {
    expect(findDibbaCourseCodes('NEW FACULTY REQUIRED')).toEqual([]);
    expect(findDibbaCourseCodes('')).toEqual([]);
  });
});

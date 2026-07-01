import { describe, it, expect } from 'vitest';
import { ordinalCode } from '../handout-ordinals';
import { renderBitsHandout } from '../handout-renderer';
import type { BitsHandoutV1 } from '../handout-schema';
import golden from '../__fixtures__/handout-aelzg631.json';

const fixture = golden as BitsHandoutV1;
const clone = (): BitsHandoutV1 => JSON.parse(JSON.stringify(fixture));

describe('ordinalCode', () => {
  it('derives 1-based codes from position', () => {
    expect(ordinalCode('CO', 0)).toBe('CO1');
    expect(ordinalCode('CO', 2)).toBe('CO3');
    expect(ordinalCode('T', 0)).toBe('T1');
    expect(ordinalCode('R', 1)).toBe('R2');
    expect(ordinalCode('LO', 3)).toBe('LO4');
  });
});

describe('renderer — codes are derived from position, not the stored code', () => {
  it('renders CO1, CO2, CO3 in array order regardless of the stored code', () => {
    const h = clone();
    // Deliberately scramble the stored codes AND leave a bogus one.
    h.partA.courseObjectives = [
      { code: 'CO9', description: 'first-obj' },
      { code: 'CO2', description: 'second-obj' },
      { code: 'CO1', description: 'third-obj' },
    ];
    const html = renderBitsHandout(h);
    // position 0 → CO1 (ignores stored CO9), paired with its own description
    expect(html).toContain('<td>CO1</td><td>first-obj</td>');
    expect(html).toContain('<td>CO2</td><td>second-obj</td>');
    expect(html).toContain('<td>CO3</td><td>third-obj</td>');
    // the scrambled stored codes never leak into the output
    expect(html).not.toContain('CO9');
    expect(html).not.toContain('<td>CO2</td><td>first-obj</td>');
  });

  it('derives T / R / LO the same way', () => {
    const h = clone();
    h.partA.textBooks = [
      { code: 'T7', citation: 'book-a' },
      { code: 'T3', citation: 'book-b' },
    ];
    h.partA.referenceBooks = [{ code: 'R5', citation: 'ref-a' }];
    h.partA.learningOutcomes = [{ code: 'LO8', description: 'outcome-a' }];
    const html = renderBitsHandout(h);
    expect(html).toContain('<td>T1</td><td>book-a</td>');
    expect(html).toContain('<td>T2</td><td>book-b</td>');
    expect(html).toContain('<td>R1</td><td>ref-a</td>');
    expect(html).toContain('<td>LO1</td><td>outcome-a</td>');
    expect(html).not.toMatch(/T7|T3|R5|LO8/);
  });

  it('leaves free-form ordinals (sessionNumber, experimentNumber, ecNumber) untouched', () => {
    const html = renderBitsHandout(fixture);
    // sessionNumber ranges like "5-6" and ecNumber "EC-1" are author-entered.
    expect(html).toContain('EC-1');
  });
});

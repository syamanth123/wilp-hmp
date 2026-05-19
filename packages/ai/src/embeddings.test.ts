import { describe, it, expect } from 'vitest';
import { cosine } from './embeddings';

describe('cosine', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
  });

  it('is symmetric', () => {
    const a = [0.2, 0.4, 0.9];
    const b = [0.7, 0.1, 0.5];
    expect(cosine(a, b)).toBeCloseTo(cosine(b, a), 6);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosine([1, 0], [0, 1])).toBe(0);
  });

  it('returns 0 when a vector is empty', () => {
    expect(cosine([], [])).toBe(0);
    expect(cosine([1, 2], [])).toBe(0);
  });

  it('returns 0 when lengths mismatch', () => {
    expect(cosine([1, 2, 3], [1, 2])).toBe(0);
  });

  it('returns 0 when either vector is the zero vector', () => {
    expect(cosine([0, 0, 0], [1, 1, 1])).toBe(0);
  });

  it('handles negative components', () => {
    expect(cosine([1, -1], [-1, 1])).toBeCloseTo(-1, 6);
  });
});

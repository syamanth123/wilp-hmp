import { describe, it, expect } from 'vitest';
import { buildChecklistItems } from './faculty-signals';

const empty = { text: '', versionCount: 0, blooms: null, coverage: null };

describe('buildChecklistItems', () => {
  it('returns 6 items', () => {
    expect(buildChecklistItems(empty)).toHaveLength(6);
  });

  it('marks nothing done for empty inputs', () => {
    const items = buildChecklistItems(empty);
    expect(items.every((i) => i.done === false)).toBe(true);
  });

  it('detects objectives keyword', () => {
    const items = buildChecklistItems({ ...empty, text: 'learning objectives for this course' });
    expect(items.find((i) => i.label.startsWith('Learning objectives'))?.done).toBe(true);
  });

  it('detects syllabus via coverage ratio', () => {
    const items = buildChecklistItems({ ...empty, coverage: { coverageRatio: 0.5 } });
    expect(items.find((i) => i.label.startsWith('Syllabus'))?.done).toBe(true);
  });

  it('detects syllabus via keywords when coverage absent', () => {
    const items = buildChecklistItems({ ...empty, text: 'modules covered:' });
    expect(items.find((i) => i.label.startsWith('Syllabus'))?.done).toBe(true);
  });

  it('detects evaluation, references, version count', () => {
    const items = buildChecklistItems({
      text: 'assessment plan and recommended textbook',
      versionCount: 2,
      blooms: null,
      coverage: null,
    });
    const labels = items.filter((i) => i.done).map((i) => i.label);
    expect(labels).toContain('Evaluation scheme detailed');
    expect(labels).toContain('Reference materials cited');
    expect(labels).toContain('At least one saved version');
  });

  it('flags Bloom coverage only when >=3 levels above threshold', () => {
    const two = buildChecklistItems({ ...empty, blooms: { remember: 0.5, apply: 0.5, analyze: 0.01 } });
    expect(two.find((i) => i.label.includes('Bloom'))?.done).toBe(false);
    const three = buildChecklistItems({ ...empty, blooms: { remember: 0.4, apply: 0.3, analyze: 0.3 } });
    expect(three.find((i) => i.label.includes('Bloom'))?.done).toBe(true);
  });

  it('ignores blooms buckets below threshold', () => {
    const items = buildChecklistItems({ ...empty, blooms: { a: 0.01, b: 0.02, c: 0.03, d: 0.04 } });
    expect(items.find((i) => i.label.includes('Bloom'))?.done).toBe(false);
  });
});

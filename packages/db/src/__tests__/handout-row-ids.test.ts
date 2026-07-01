import { describe, it, expect } from 'vitest';
import { BitsHandoutSchemaV1, type BitsHandoutV1 } from '../handout-schema';
import { makeRowId, backfillRowIds } from '../handout-row-ids';
import golden from '../__fixtures__/handout-aelzg631.json';

const fixture = golden as BitsHandoutV1;
const clone = (): BitsHandoutV1 => JSON.parse(JSON.stringify(fixture));

/** Every repeatable row's id across the whole handout (undefined slots kept, so
 * a missing id shows up as `undefined`). */
function allRowIds(d: BitsHandoutV1): (string | undefined)[] {
  const ids: (string | undefined)[] = [
    ...d.partA.courseObjectives,
    ...d.partA.textBooks,
    ...d.partA.referenceBooks,
    ...d.partA.learningOutcomes,
    ...d.partB.sessions,
    ...(d.experientialLearning?.components ?? []),
    ...(d.experientialLearning?.experiments ?? []),
    ...d.evaluation.components,
    ...d.evaluation.components.flatMap((c) => c.subComponents),
  ].map((r) => r.id);
  return ids;
}

describe('opaque row ids — additive schema change', () => {
  it('the golden fixture (no ids) still parses — additive, backward-compatible', () => {
    const parsed = BitsHandoutSchemaV1.safeParse(golden);
    expect(parsed.success).toBe(true);
    // and it genuinely has no ids yet (so the backfill tests below are meaningful)
    expect(allRowIds(golden as BitsHandoutV1).every((id) => id === undefined)).toBe(true);
  });

  it('data WITH ids also parses (round-trips through the schema)', () => {
    const withIds = backfillRowIds(clone());
    expect(BitsHandoutSchemaV1.safeParse(withIds).success).toBe(true);
  });
});

describe('makeRowId', () => {
  it('returns distinct non-empty strings', () => {
    const a = makeRowId();
    const b = makeRowId();
    expect(a).toBeTruthy();
    expect(typeof a).toBe('string');
    expect(a).not.toBe(b);
  });
});

describe('backfillRowIds', () => {
  it('mints an id on EVERY repeatable row, including nested sub-components', () => {
    const out = backfillRowIds(clone());
    const ids = allRowIds(out);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
    // all unique
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is idempotent — existing ids are preserved on a second pass', () => {
    const once = backfillRowIds(clone());
    const twice = backfillRowIds(once);
    expect(allRowIds(twice)).toEqual(allRowIds(once));
    expect(twice).toEqual(once);
  });

  it('preserves a pre-set id and only mints for the id-less rows', () => {
    const d = clone();
    d.partA.textBooks[0]!.id = 'preset-T1';
    const out = backfillRowIds(d);
    expect(out.partA.textBooks[0]!.id).toBe('preset-T1'); // untouched
    expect(out.partA.textBooks.slice(1).every((b) => b.id && b.id !== 'preset-T1')).toBe(true);
  });

  it('does not mutate the input (pure)', () => {
    const d = clone();
    backfillRowIds(d);
    expect(allRowIds(d).every((id) => id === undefined)).toBe(true); // input untouched
  });

  it('leaves every non-id field byte-for-byte identical (renderer output unaffected)', () => {
    const d = clone();
    const out = backfillRowIds(d);
    // strip ids back out → must equal the original
    const stripIds = (x: BitsHandoutV1) =>
      JSON.parse(JSON.stringify(x), (k, v) => (k === 'id' ? undefined : v));
    expect(stripIds(out)).toEqual(stripIds(d));
  });
});

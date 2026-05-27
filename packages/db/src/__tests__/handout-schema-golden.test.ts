import { describe, it, expect } from 'vitest';
import { BitsHandoutSchemaV1, BitsHandoutSchema } from '../handout-schema';
import golden from '../__fixtures__/handout-aelzg631.json';

/**
 * Golden-file test: a faithful, full transcription of a REAL BITS lab handout
 * (`AEL ZG631 — Automotive Diagnostics and Interfaces`) must parse cleanly under
 * `BitsHandoutSchemaV1`. This is the schema's anchor to reality — it's the
 * concrete evidence behind every corpus-driven schema decision (sessionNumber
 * ranges, optional credit-model hours, optional creditUnits/versionNo). If a
 * future schema edit breaks the real handout, this test fails loudly.
 *
 * Fidelity is asserted spot-by-spot below so an accidental edit to the fixture
 * (a renamed instructor, a dropped course number) is caught, not just a parse.
 */
describe('Golden file — AEL ZG631 parses under BitsHandoutSchemaV1', () => {
  it('the full real handout parses with no errors', () => {
    const result = BitsHandoutSchemaV1.safeParse(golden);
    // Surface the first Zod issue if it ever breaks — far easier to debug.
    expect(result.success ? null : result.error.issues[0]).toBeNull();
    expect(result.success).toBe(true);
  });

  it('routes through the discriminated union to V1', () => {
    const parsed = BitsHandoutSchema.parse(golden);
    expect(parsed.schemaVersion).toBe(1);
  });

  const h = BitsHandoutSchemaV1.parse(golden);

  it('preserves the dual course numbers verbatim', () => {
    expect(h.partA.courseNumbers).toEqual(['AE ZG631', 'AEL ZG631']);
  });
  it('preserves the instructor name verbatim (caps as printed)', () => {
    expect(h.partA.instructors).toEqual(['KOTHA SRINIVASA REDDY']);
  });
  it('preserves the course title verbatim', () => {
    expect(h.partA.courseTitle).toBe('Automotive Diagnostics and Interfaces');
  });
  it('carries the credit model as the short code with no hour breakdown', () => {
    expect(h.partA.creditModel.description).toBe('3-1-1');
    expect(h.partA.creditModel.classroomHours).toBeUndefined();
  });
  it('omits the blank Credit Units and Version No cells', () => {
    expect(h.partA.creditUnits).toBeUndefined();
    expect(h.partA.versionNo).toBeUndefined();
  });
  it('keeps the full course description (not a head/tail truncation)', () => {
    expect(h.partA.courseDescription).toContain('Sensors used in today');
    expect(h.partA.courseDescription).toContain(
      'reliability, diagnostics, and testing of vehicles',
    );
  });
  it('has all 16 contact sessions including the ranges', () => {
    expect(h.partB.sessions).toHaveLength(13); // 13 rows; 3 of them span ranges
    const numbers = h.partB.sessions.map((s) => s.sessionNumber);
    expect(numbers).toContain('5-6');
    expect(numbers).toContain('7-8');
    expect(numbers).toContain('12-13');
  });
  it('evaluation weights sum to 100 across all sub-components', () => {
    const total = h.evaluation.components
      .flatMap((c) => c.subComponents)
      .reduce((sum, sc) => sum + sc.weight, 0);
    expect(total).toBe(100);
  });

  // The experiential mapping is APPROXIMATE and interpretive — AEL ZG631's two
  // experiential tables ("Tut. No." → experiments[]; "Sr No / Lab Details" →
  // labInfrastructure[]) don't map 1:1 onto the schema shape. This is the
  // documented live example of the structure-mismatch problem Prompt 11f owns;
  // see docs/dev-handoff-audit.md §5 "Experiential-section structure variance".
  it('maps the experiential section (approximate; canonical mapping is 11f work)', () => {
    expect(h.experientialLearning?.experiments).toHaveLength(4);
    expect(h.experientialLearning?.labInfrastructure).toHaveLength(3);
    expect(h.experientialLearning?.components).toEqual([]);
  });
});

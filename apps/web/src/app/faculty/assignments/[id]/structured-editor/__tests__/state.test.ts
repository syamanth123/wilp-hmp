import { describe, it, expect } from 'vitest';
import { BitsHandoutSchemaV1 } from '@hmp/db';
import { blankHandoutForRequest } from '../state';

describe('blankHandoutForRequest — produces a Zod-valid BitsHandoutV1', () => {
  const baseCtx = {
    courseTitle: 'Software Quality Assurance and Testing',
    courseNumbers: ['SE ZG501'],
    instructorName: 'Dr. Faculty Member',
    semesterName: 'Sem-I 2025-26',
  };

  it('passes BitsHandoutSchemaV1.safeParse on first call', () => {
    const data = blankHandoutForRequest(baseCtx);
    const parsed = BitsHandoutSchemaV1.safeParse(data);
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues, null, 2)).toBe(
      true,
    );
  });

  it('seeds the schema-required min(1) arrays with one row each', () => {
    const data = blankHandoutForRequest(baseCtx);
    expect(data.partA.courseObjectives).toHaveLength(1);
    expect(data.partA.courseObjectives[0]!.code).toBe('CO1');
    expect(data.partA.textBooks).toHaveLength(1);
    expect(data.partA.textBooks[0]!.code).toBe('T1');
    expect(data.partA.learningOutcomes).toHaveLength(1);
    expect(data.partA.learningOutcomes[0]!.code).toBe('LO1');
    expect(data.partB.sessions).toHaveLength(1);
  });

  it('leaves referenceBooks empty (schema allows)', () => {
    const data = blankHandoutForRequest(baseCtx);
    expect(data.partA.referenceBooks).toEqual([]);
  });

  it('leaves experientialLearning absent (schema optional)', () => {
    const data = blankHandoutForRequest(baseCtx);
    expect(data.experientialLearning).toBeUndefined();
  });

  it('pre-populates courseTitle and courseNumbers from the request context', () => {
    const data = blankHandoutForRequest(baseCtx);
    expect(data.partA.courseTitle).toBe('Software Quality Assurance and Testing');
    expect(data.partA.courseNumbers).toEqual(['SE ZG501']);
  });

  it('handles a multi-coded course (e.g. AE ZG631 + AEL ZG631)', () => {
    const data = blankHandoutForRequest({
      ...baseCtx,
      courseTitle: 'Automotive Diagnostics and Interfaces',
      courseNumbers: ['AE ZG631', 'AEL ZG631'],
    });
    expect(data.partA.courseNumbers).toEqual(['AE ZG631', 'AEL ZG631']);
    expect(BitsHandoutSchemaV1.safeParse(data).success).toBe(true);
  });

  it('falls back to a non-empty placeholder courseNumber if context is empty (production never hits this path)', () => {
    const data = blankHandoutForRequest({ ...baseCtx, courseNumbers: [] });
    // Schema requires min(1) courseNumbers AND each element must be non-empty.
    expect(data.partA.courseNumbers).toEqual(['TBD']);
    expect(BitsHandoutSchemaV1.safeParse(data).success).toBe(true);
  });

  it('uses an empty instructor placeholder when context provides none (still schema-valid)', () => {
    const data = blankHandoutForRequest({ ...baseCtx, instructorName: '' });
    expect(data.partA.instructors.length).toBeGreaterThanOrEqual(1);
    expect(BitsHandoutSchemaV1.safeParse(data).success).toBe(true);
  });

  it("seeds the eLearn portal URL to BITS' canonical one (schema requires URL)", () => {
    const data = blankHandoutForRequest(baseCtx);
    expect(data.importantLinks.elearnPortalUrl).toBe('https://elearn.bits-pilani.ac.in');
  });

  it('seeds evaluation.components as empty array (schema allows; faculty adds in the UI)', () => {
    const data = blankHandoutForRequest(baseCtx);
    expect(data.evaluation.components).toEqual([]);
    expect(BitsHandoutSchemaV1.safeParse(data).success).toBe(true);
  });
});

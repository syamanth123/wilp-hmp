import { describe, it, expect } from 'vitest';
import {
  BitsHandoutSchemaV1,
  BitsHandoutSchema,
  LATEST_SCHEMA_VERSION,
  type BitsHandoutV1,
} from '../handout-schema';

// A minimal STRUCTURALLY-valid handout used as the base for rejection tests.
// The faithful, full transcription of a real golden handout (AEL ZG631) lives
// in the separate golden-file test (handout-schema-golden.test.ts +
// __fixtures__/handout-aelzg631.json).
function makeValidHandout(): BitsHandoutV1 {
  return {
    schemaVersion: 1,
    metadata: {
      institutionHeader: 'BITS Pilani',
      divisionHeader: 'Work Integrated Learning Programmes',
      semester: 'Second Semester 2024-2025',
      documentTitle: 'Course Handout',
      formNumber: 'F-XYZ',
    },
    partA: {
      courseTitle: 'Computer Programming',
      courseNumbers: ['MTBFZC221'],
      creditUnits: 3,
      creditModel: {
        classroomHours: 32,
        tutorialHours: 0,
        preparationHours: 64,
        description: '3 units',
      },
      instructors: ['Dr. Example'],
      versionNo: 1,
      date: '12-01-2025',
      courseDescription: '<p>desc</p>',
      courseObjectives: [{ code: 'CO1', description: 'objective one' }],
      textBooks: [{ code: 'T1', citation: 'Some Book, 1st Ed.' }],
      referenceBooks: [],
      learningOutcomes: [{ code: 'LO1', description: 'outcome one' }],
    },
    partB: {
      sessions: [
        { sessionNumber: '1', topicTitle: 'Intro', subTopics: 'a, b, c', references: ['T1'] },
      ],
    },
    experientialLearning: {
      components: [],
      overallObjective: '<p>obj</p>',
      overallScope: [],
      labInfrastructure: [],
      experiments: [],
    },
    evaluation: {
      legend: 'EC = Evaluation Component',
      components: [],
      notes: '',
      midSemSyllabus: '',
      compreSyllabus: '',
    },
    importantLinks: {
      elearnPortalUrl: 'https://elearn.bits-pilani.ac.in',
      elearnPortalNote: '',
      contactSessionsNote: '',
    },
    evaluationGuidelines: '<p>guidelines</p>',
  };
}

describe('BitsHandoutSchemaV1 — valid baseline', () => {
  it('accepts a structurally-valid handout', () => {
    expect(BitsHandoutSchemaV1.parse(makeValidHandout())).toBeTruthy();
  });

  it('accepts a handout with NO experientialLearning (real theory course — CC ZG501)', () => {
    const h = makeValidHandout() as Record<string, unknown>;
    delete h.experientialLearning;
    expect(BitsHandoutSchemaV1.safeParse(h).success).toBe(true);
  });

  it('accepts optional fields being absent (laboratoryComponent, scheduledAt)', () => {
    const h = makeValidHandout();
    expect(h.partA.laboratoryComponent).toBeUndefined();
    h.evaluation.components = [
      {
        ecNumber: 'EC-1',
        subComponents: [{ name: 'Quiz', type: 'Online', weight: 10, duration: '30 min' }],
      },
    ];
    const parsed = BitsHandoutSchemaV1.parse(h);
    expect(parsed.evaluation.components[0]!.subComponents[0]!.scheduledAt).toBeUndefined();
  });
});

describe('BitsHandoutSchemaV1 — coded-list regex enforcement', () => {
  it('rejects a malformed CO code (CO5a)', () => {
    const h = makeValidHandout();
    h.partA.courseObjectives = [{ code: 'CO5a', description: 'x' }];
    expect(BitsHandoutSchemaV1.safeParse(h).success).toBe(false);
  });
  it('rejects a lowercase text-book code (t1)', () => {
    const h = makeValidHandout();
    h.partA.textBooks = [{ code: 't1', citation: 'x' }];
    expect(BitsHandoutSchemaV1.safeParse(h).success).toBe(false);
  });
  it('accepts R0 as a valid reference code (regex is /^R\\d+$/)', () => {
    const h = makeValidHandout();
    h.partA.referenceBooks = [{ code: 'R0', citation: 'x' }];
    expect(BitsHandoutSchemaV1.safeParse(h).success).toBe(true);
  });
  it('rejects a malformed reference code (Rx)', () => {
    const h = makeValidHandout();
    h.partA.referenceBooks = [{ code: 'Rx', citation: 'x' }];
    expect(BitsHandoutSchemaV1.safeParse(h).success).toBe(false);
  });
  it('rejects a malformed LO code (LO1a)', () => {
    const h = makeValidHandout();
    h.partA.learningOutcomes = [{ code: 'LO1a', description: 'x' }];
    expect(BitsHandoutSchemaV1.safeParse(h).success).toBe(false);
  });
});

describe('BitsHandoutSchemaV1 — evaluation weight bounds', () => {
  const withWeight = (weight: number) => {
    const h = makeValidHandout();
    h.evaluation.components = [
      {
        ecNumber: 'EC-1',
        subComponents: [{ name: 'Quiz', type: 'Online', weight, duration: '30m' }],
      },
    ];
    return BitsHandoutSchemaV1.safeParse(h).success;
  };
  it('rejects a negative weight', () => expect(withWeight(-5)).toBe(false));
  it('rejects a weight > 100', () => expect(withWeight(150)).toBe(false));
  it('accepts a weight within 0–100', () => expect(withWeight(30)).toBe(true));
});

describe('BitsHandoutSchemaV1 — required non-empty arrays + fields', () => {
  it('rejects an empty courseNumbers array', () => {
    const h = makeValidHandout();
    h.partA.courseNumbers = [];
    expect(BitsHandoutSchemaV1.safeParse(h).success).toBe(false);
  });
  it('rejects an empty instructors array', () => {
    const h = makeValidHandout();
    h.partA.instructors = [];
    expect(BitsHandoutSchemaV1.safeParse(h).success).toBe(false);
  });
  it('rejects an empty Part B sessions array', () => {
    const h = makeValidHandout();
    h.partB.sessions = [];
    expect(BitsHandoutSchemaV1.safeParse(h).success).toBe(false);
  });
  it('rejects a missing courseTitle', () => {
    const h = makeValidHandout() as Record<string, unknown>;
    delete (h.partA as Record<string, unknown>).courseTitle;
    expect(BitsHandoutSchemaV1.safeParse(h).success).toBe(false);
  });
  it('rejects a missing partB', () => {
    const h = makeValidHandout() as Record<string, unknown>;
    delete h.partB;
    expect(BitsHandoutSchemaV1.safeParse(h).success).toBe(false);
  });
  it('allows referenceBooks to be empty (the corpus has handouts with none)', () => {
    const h = makeValidHandout();
    h.partA.referenceBooks = [];
    expect(BitsHandoutSchemaV1.safeParse(h).success).toBe(true);
  });
});

describe('BitsHandoutSchemaV1 — irregular real-world values', () => {
  it('accepts non-numeric experimentNumber ("6.") and numberOfExercises ("As per")', () => {
    const h = makeValidHandout();
    // makeValidHandout always supplies experientialLearning; it's `.optional()`
    // on the schema (CC ZG501 has none) so TS sees `T | undefined` here.
    h.experientialLearning!.experiments = [
      { experimentNumber: '6.', title: 'Exp', moduleReference: 'M2' },
    ];
    h.experientialLearning!.components = [
      {
        name: 'Lab',
        objective: 'o',
        outcome: 'out',
        labInfrastructure: 'MATLAB',
        numberOfExercises: 'As per',
        scope: 's',
      },
    ];
    expect(BitsHandoutSchemaV1.safeParse(h).success).toBe(true);
  });
});

describe('BitsHandoutSchemaV1 — corpus-driven optional fields (AEL ZG631)', () => {
  it('accepts a range sessionNumber ("5-6") — combined contact sessions', () => {
    const h = makeValidHandout();
    h.partB.sessions[0]!.sessionNumber = '5-6';
    expect(BitsHandoutSchemaV1.safeParse(h).success).toBe(true);
  });
  it('accepts a creditModel with only a description (short code, no hour breakdown)', () => {
    const h = makeValidHandout();
    h.partA.creditModel = { description: '3-1-1' };
    const parsed = BitsHandoutSchemaV1.parse(h);
    expect(parsed.partA.creditModel.classroomHours).toBeUndefined();
  });
  it('accepts a handout with no creditUnits (cell blank in the source)', () => {
    const h = makeValidHandout() as Record<string, unknown>;
    delete (h.partA as Record<string, unknown>).creditUnits;
    expect(BitsHandoutSchemaV1.safeParse(h).success).toBe(true);
  });
  it('accepts a handout with no versionNo (cell blank in the source)', () => {
    const h = makeValidHandout() as Record<string, unknown>;
    delete (h.partA as Record<string, unknown>).versionNo;
    expect(BitsHandoutSchemaV1.safeParse(h).success).toBe(true);
  });
});

describe('importantLinks URL validation', () => {
  it('rejects an invalid eLearn portal URL', () => {
    const h = makeValidHandout();
    h.importantLinks.elearnPortalUrl = 'not-a-url';
    expect(BitsHandoutSchemaV1.safeParse(h).success).toBe(false);
  });
});

describe('schema versioning', () => {
  it('LATEST_SCHEMA_VERSION equals 1', () => {
    expect(LATEST_SCHEMA_VERSION).toBe(1);
  });
  it('rejects a non-1 schemaVersion', () => {
    const h = makeValidHandout() as Record<string, unknown>;
    h.schemaVersion = 2;
    expect(BitsHandoutSchemaV1.safeParse(h).success).toBe(false);
  });
  it('the discriminated union resolves a { schemaVersion: 1, ... } value to V1', () => {
    const parsed = BitsHandoutSchema.parse(makeValidHandout());
    expect(parsed.schemaVersion).toBe(1);
    // narrowing on the discriminant works
    if (parsed.schemaVersion === 1) {
      expect(parsed.partA.courseTitle).toBe('Computer Programming');
    }
  });
});

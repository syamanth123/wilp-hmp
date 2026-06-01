import type { BitsHandoutV1 } from '@hmp/db';

/**
 * Request context surfaced from the page (server component) to the editor
 * (client) for the Convert button + blank-handout pre-population.
 */
export interface RequestContext {
  courseTitle: string;
  courseNumbers: string[];
  instructorName: string;
  semesterName: string;
}

/**
 * Build a blank-but-Zod-valid `BitsHandoutV1` from request context. Used by
 * the Convert flow (legacy → structured) AND as the initial state for a
 * faculty who's never saved a structured version. Every `min(1)` array gets
 * one placeholder row so `BitsHandoutSchemaV1.safeParse` passes on first
 * load — the faculty edits in place.
 */
export function blankHandoutForRequest(ctx: RequestContext): BitsHandoutV1 {
  return {
    schemaVersion: 1,
    metadata: {
      institutionHeader: 'Birla Institute of Technology & Science, Pilani',
      divisionHeader: 'Work Integrated Learning Programmes Division',
      semester: ctx.semesterName,
      documentTitle: 'Digital Learning Handout',
      formNumber: '',
    },
    partA: {
      courseTitle: ctx.courseTitle,
      // Schema requires `z.string().min(1)` per courseNumber, so use a clearly
      // placeholder value if no context is supplied (production never hits
      // this path — convertToStructuredAction always passes at least the
      // bitsCourseNumber). 'TBD' makes the field human-visibly incomplete.
      courseNumbers: ctx.courseNumbers.length > 0 ? ctx.courseNumbers : ['TBD'],
      creditModel: { description: '3-1-1' },
      instructors: ctx.instructorName ? [ctx.instructorName] : [''],
      date: new Date().toLocaleDateString('en-GB'),
      courseDescription: '<p></p>',
      courseObjectives: [{ code: 'CO1', description: '' }],
      textBooks: [{ code: 'T1', citation: '' }],
      referenceBooks: [],
      learningOutcomes: [{ code: 'LO1', description: '' }],
    },
    partB: {
      sessions: [{ sessionNumber: '1', topicTitle: '', subTopics: '', references: [] }],
    },
    // experientialLearning: omitted by default (optional)
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
    evaluationGuidelines: '<p></p>',
  };
}

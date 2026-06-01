import { prisma, BitsHandoutSchemaV1, type BitsHandoutV1 } from '@hmp/db';
import { getAiClient } from './client';

export type StructuredDraftSource = 'ai' | 'cache' | 'stub';

export interface GenerateStructuredHandoutDraftInput {
  /** ID of the Handout row (NOT the request). */
  handoutId: string;
  /** Skip the cache and re-generate. */
  forceRefresh?: boolean;
}

export interface StructuredHandoutDraftResult {
  draftId: string;
  data: BitsHandoutV1;
  model: string;
  source: StructuredDraftSource;
  createdAt: Date;
}

const RATE_LIMIT_WINDOW_MS = 5 * 60_000;

/**
 * System prompt for the structured BITS handout draft.
 *
 * Approach (approved in Prompt 11d-b Decision 2): TypeScript-as-DSL — the
 * model is given the `BitsHandoutV1` type definition as a TypeScript
 * interface and a single compact worked example. Modern LLMs handle this
 * pattern well (trained on a lot of TypeScript + Zod), and it's
 * token-cheaper than describing the schema in natural language.
 *
 * The example is deliberately COMPACT (2 Part B sessions, 1 EC with 2
 * sub-components) — enough to show conventions without bloating the prompt.
 * The model generalises from the example to fill the real course context.
 */
const SYSTEM_PROMPT = `You are filling in a BITS WILP "Digital Learning Handout" structure.

Return STRICT JSON matching this TypeScript type (no prose, no markdown fences, just JSON):

interface BitsHandoutV1 {
  schemaVersion: 1;
  metadata: { institutionHeader: string; divisionHeader: string; semester: string; documentTitle: string; formNumber: string; };
  partA: {
    courseTitle: string;
    courseNumbers: string[];            // at least one; e.g. ["AE ZG631"] or cross-listed ["AE ZG631","AEL ZG631"]
    creditUnits?: number;
    creditModel: { description: string; classroomHours?: number; tutorialHours?: number; preparationHours?: number; };
    instructors: string[];              // at least one
    versionNo?: number;
    date: string;                       // free-form, e.g. "6 Jan 2025"
    courseDescription: string;          // 1-2 sentences, plain text or <p>...</p>
    laboratoryComponent?: string;       // optional HTML
    courseObjectives: { code: string; description: string; }[];   // code matches /^CO\\d+$/
    textBooks:        { code: string; citation: string; }[];      // code matches /^T\\d+$/
    referenceBooks:   { code: string; citation: string; }[];      // code matches /^R\\d+$/ ; may be empty
    learningOutcomes: { code: string; description: string; }[];   // code matches /^LO\\d+$/
  };
  partB: { sessions: { sessionNumber: string; topicTitle: string; subTopics: string; references: string[]; }[]; };
  experientialLearning?: { components: never[]; overallObjective: string; overallScope: string[]; labInfrastructure: string[]; experiments: never[]; };
  evaluation: {
    legend: string;
    components: { ecNumber: string; subComponents: { name: string; type: string; weight: number; duration: string; scheduledAt?: string; }[]; }[];
    notes: string; midSemSyllabus: string; compreSyllabus: string;
  };
  importantLinks: { elearnPortalUrl: string; elearnPortalNote: string; contactSessionsNote: string; };
  evaluationGuidelines: string;        // HTML block
}

Example (compact — generalise to fill 8-16 sessions and 3-4 evaluation components for the actual course):
{
  "schemaVersion": 1,
  "metadata": { "institutionHeader": "Birla Institute of Technology & Science, Pilani", "divisionHeader": "Work Integrated Learning Programmes Division", "semester": "First Semester 2025-2026", "documentTitle": "Digital Learning Handout", "formNumber": "" },
  "partA": {
    "courseTitle": "Automotive Diagnostics and Interfaces",
    "courseNumbers": ["AE ZG631","AEL ZG631"],
    "creditModel": { "description": "3-1-1" },
    "instructors": ["KOTHA SRINIVASA REDDY"],
    "date": "6 Jan 2025",
    "courseDescription": "<p>Sensors used in today's vehicles; OBD II; DC-DC converter control; automotive diagnostics.</p>",
    "courseObjectives": [{ "code": "CO1", "description": "Study automotive sensors and interfacing" }, { "code": "CO2", "description": "Understand on-board diagnostics tools" }],
    "textBooks":      [{ "code": "T1",  "citation": "Tom Denton 2021, Routledge, Advanced Automotive Fault Diagnosis 5th ed" }],
    "referenceBooks": [{ "code": "R1",  "citation": "William B. Ribbens 2017, Butterworth-Heinemann, Understanding Automotive electronics 8th ed" }],
    "learningOutcomes": [{ "code": "LO1", "description": "Diagnose electrical and mechanical systems in automobiles" }, { "code": "LO2", "description": "Develop modeling methods for converters" }]
  },
  "partB": { "sessions": [
    { "sessionNumber": "1", "topicTitle": "Introduction to automotive diagnostics", "subTopics": "Introduction to diagnostics; Diagnostics techniques", "references": ["T1 Chap 1, 2"] },
    { "sessionNumber": "5-6", "topicTitle": "Engine Diagnostics", "subTopics": "Fuel system diagnostics; Ignition diagnostics", "references": ["T1 Chap 6"] }
  ] },
  "evaluation": { "legend": "EC = Evaluation Component", "components": [
    { "ecNumber": "EC-1", "subComponents": [{ "name": "Quiz", "type": "Online", "weight": 30, "duration": "30m" }] },
    { "ecNumber": "EC-2", "subComponents": [{ "name": "Mid-Sem exam", "type": "Closed book", "weight": 30, "duration": "2h" }, { "name": "Compre exam", "type": "Open book", "weight": 40, "duration": "2.5h" }] }
  ], "notes": "", "midSemSyllabus": "", "compreSyllabus": "" },
  "importantLinks": { "elearnPortalUrl": "https://elearn.bits-pilani.ac.in", "elearnPortalNote": "", "contactSessionsNote": "" },
  "evaluationGuidelines": "<p>For closed-book tests, no books or reference material permitted.</p>"
}

Constraints:
- Sub-component weights MUST sum to 100 across all ECs.
- All CO / T / R / LO codes must match the regex (CO1, T1, R1, LO1 — no spaces, no decimals).
- courseNumbers, instructors, courseObjectives, textBooks, learningOutcomes must each have at least one entry.
- partB.sessions: 8-16 entries that cover the course's actual topics. Use ranges like "5-6" for combined contact sessions when appropriate.
- Be concrete and grounded in the course title / programme / semester. Do not invent unrelated topics.
- Return ONLY the JSON object, no surrounding text.`;

function buildUserPrompt(input: {
  courseCode: string;
  courseTitle: string;
  courseDescription: string;
  programmeName: string;
  semesterName: string;
}): string {
  return [
    `# Course`,
    `${input.courseCode} — ${input.courseTitle}`,
    ``,
    `## Programme / Semester`,
    `${input.programmeName} · ${input.semesterName}`,
    ``,
    `## Course description / syllabus (may be brief or empty)`,
    input.courseDescription ||
      '(none provided — generate a faithful BITS-style draft from the course title alone)',
  ].join('\n');
}

/**
 * Stub path used when the AI provider is unconfigured (AI_PROVIDER=noop).
 * Produces a Zod-valid `BitsHandoutV1` derived from the request's course
 * context. The UI marks this as "Using template stub" so faculty knows
 * they're getting a generic starting point, not a customised draft.
 */
function buildStubStructuredDraft(
  course: {
    code: string;
    title: string;
    description: string | null;
  },
  semesterName: string,
): BitsHandoutV1 {
  return {
    schemaVersion: 1,
    metadata: {
      institutionHeader: 'Birla Institute of Technology & Science, Pilani',
      divisionHeader: 'Work Integrated Learning Programmes Division',
      semester: semesterName,
      documentTitle: 'Digital Learning Handout',
      formNumber: '',
    },
    partA: {
      courseTitle: course.title,
      courseNumbers: [course.code],
      creditModel: { description: '3-1-1' },
      instructors: ['Course instructor (TBD)'],
      date: new Date().toLocaleDateString('en-GB'),
      courseDescription:
        course.description?.trim() ||
        `<p>${course.title} is a foundational course offered under BITS WILP. This draft is a template stub — connect an AI provider to generate a real outline grounded in the course syllabus.</p>`,
      courseObjectives: [
        { code: 'CO1', description: 'Explain the foundational concepts of the course.' },
        { code: 'CO2', description: 'Apply key techniques to representative problems.' },
        { code: 'CO3', description: 'Analyse trade-offs in solution approaches.' },
      ],
      textBooks: [
        { code: 'T1', citation: 'Primary textbook — author, title, latest edition (placeholder)' },
      ],
      referenceBooks: [],
      learningOutcomes: [
        { code: 'LO1', description: 'Demonstrate understanding of core concepts.' },
        { code: 'LO2', description: 'Apply techniques to solve representative problems.' },
        { code: 'LO3', description: 'Evaluate outcomes against established criteria.' },
      ],
    },
    partB: {
      sessions: [
        {
          sessionNumber: '1',
          topicTitle: 'Course overview and motivation',
          subTopics: 'Introduction; Learning outcomes; Resource map',
          references: ['T1 Chap 1'],
        },
        {
          sessionNumber: '2-3',
          topicTitle: 'Foundational concepts',
          subTopics: 'Core ideas; Worked examples; Practice problems',
          references: ['T1 Chap 2-3'],
        },
        {
          sessionNumber: '4',
          topicTitle: 'Applications and synthesis',
          subTopics: 'Cross-topic problems; Case study; Review',
          references: ['T1 Chap 4'],
        },
      ],
    },
    evaluation: {
      legend: 'EC = Evaluation Component',
      components: [
        {
          ecNumber: 'EC-1',
          subComponents: [
            { name: 'Assignment', type: 'Take-home', weight: 15, duration: 'Week 4' },
            { name: 'Quiz', type: 'Online', weight: 15, duration: 'Week 6' },
          ],
        },
        {
          ecNumber: 'EC-2',
          subComponents: [
            { name: 'Mid-Semester exam', type: 'Closed book', weight: 30, duration: '2 hours' },
          ],
        },
        {
          ecNumber: 'EC-3',
          subComponents: [
            { name: 'Comprehensive exam', type: 'Open book', weight: 40, duration: '2.5 hours' },
          ],
        },
      ],
      notes: 'Template stub — confirm against the official evaluation plan.',
      midSemSyllabus: '',
      compreSyllabus: '',
    },
    importantLinks: {
      elearnPortalUrl: 'https://elearn.bits-pilani.ac.in',
      elearnPortalNote:
        'Students must visit the eLearn portal regularly and stay updated with the latest announcements and deadlines.',
      contactSessionsNote:
        'Students should attend the online lectures as per the schedule provided on the eLearn portal.',
    },
    evaluationGuidelines:
      '<p>For closed-book tests, no books or reference material of any kind will be permitted. For open-book exams, only text/reference books are permitted; no other learning material allowed.</p>',
  };
}

/**
 * Generate a structured `BitsHandoutV1` draft. Faculty applies the draft into
 * the structured editor's form state for review and editing.
 *
 * Failure modes:
 *  - AI provider unconfigured (`noop`) → returns a stub draft (source: 'stub').
 *  - AI returns malformed output or output that fails `BitsHandoutSchemaV1`
 *    → `chatJson` throws; the action layer catches and surfaces the error
 *    in the dialog. No auto-retry.
 *
 * Schema-valid but semantically poor output is the design — faculty edits
 * the draft anyway. The bar here is "round-trips through `BitsHandoutSchemaV1`
 * without throwing", not "production-grade content."
 */
export async function generateStructuredHandoutDraft(
  input: GenerateStructuredHandoutDraftInput,
): Promise<StructuredHandoutDraftResult> {
  const handout = await prisma.handout.findUnique({
    where: { id: input.handoutId },
    select: {
      id: true,
      request: {
        select: {
          offering: {
            select: {
              course: { select: { code: true, title: true, description: true } },
              semester: {
                select: { name: true, programme: { select: { name: true } } },
              },
            },
          },
        },
      },
    },
  });
  if (!handout) throw new Error('handout_not_found');

  if (!input.forceRefresh) {
    const recent = await prisma.aIDraftLog.findFirst({
      where: {
        handoutId: handout.id,
        createdAt: { gte: new Date(Date.now() - RATE_LIMIT_WINDOW_MS) },
      },
      orderBy: { createdAt: 'desc' },
    });
    // Only reuse cached drafts that have structured data — earlier cached
    // entries from the legacy TipTap path don't qualify.
    if (recent) {
      const payload = recent.payload as { data?: BitsHandoutV1 } | null;
      if (payload?.data) {
        return {
          draftId: recent.id,
          data: payload.data,
          model: recent.model,
          source: 'cache',
          createdAt: recent.createdAt,
        };
      }
    }
  }

  const course = handout.request.offering.course;
  const semesterName = handout.request.offering.semester.name;
  const programmeName = handout.request.offering.semester.programme.name;

  const client = getAiClient();

  if (client.provider === 'noop') {
    const data = buildStubStructuredDraft(course, semesterName);
    const row = await prisma.aIDraftLog.create({
      data: {
        handoutId: handout.id,
        source: 'stub',
        model: 'stub-structured-v1',
        payload: { data } as never,
      },
    });
    return {
      draftId: row.id,
      data,
      model: 'stub-structured-v1',
      source: 'stub',
      createdAt: row.createdAt,
    };
  }

  const userPrompt = buildUserPrompt({
    courseCode: course.code,
    courseTitle: course.title,
    courseDescription: course.description ?? '',
    programmeName,
    semesterName,
  });

  // `chatJson` parses with the provided Zod schema and throws on malformed
  // JSON or schema-invalid output — the action layer catches and surfaces
  // the error message verbatim in the dialog.
  const result = await client.chatJson({
    system: SYSTEM_PROMPT,
    user: userPrompt,
    schema: BitsHandoutSchemaV1,
    maxTokens: 8000,
  });

  const row = await prisma.aIDraftLog.create({
    data: {
      handoutId: handout.id,
      source: 'ai',
      model: result.model,
      payload: { data: result.data } as never,
    },
  });

  return {
    draftId: row.id,
    data: result.data,
    model: result.model,
    source: 'ai',
    createdAt: row.createdAt,
  };
}

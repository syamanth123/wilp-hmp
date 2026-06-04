import { z } from 'zod';

/**
 * BITS WILP course-handout structured schema.
 *
 * Captures the full template every BITS WILP handout follows (Part A course
 * description, Part B session plan, experiential learning, evaluation scheme,
 * important links, evaluation guidelines). This is the structured source of
 * truth for handout content going forward — `HandoutVersion.data` holds a value
 * conforming to this schema. The legacy `contentHtml`/`contentJson` columns
 * remain for pre-Prompt-11 handouts and are not touched here.
 *
 * Schema versions are EXPLICIT and never silently upgraded: `schemaVersion` is a
 * literal discriminant, and `BitsHandoutSchema` is a discriminated union so a
 * future V2 is added as a new member rather than mutating V1.
 *
 * Rich-text fields are typed `z.string()` — they carry HTML; the schema does
 * not validate HTML structure. Several fields are intentionally `z.string()`
 * rather than numbers/dates because real corpus data is irregular (see the
 * inline notes: experimentNumber "6.", numberOfExercises "As per", multiple
 * date formats).
 */

export const LATEST_SCHEMA_VERSION = 1 as const;

// --- Part A leaf schemas (coded list items) ---
const courseObjective = z.object({
  code: z.string().regex(/^CO\d+$/),
  description: z.string(),
});
const textBook = z.object({
  code: z.string().regex(/^T\d+$/),
  citation: z.string(),
});
const referenceBook = z.object({
  code: z.string().regex(/^R\d+$/),
  citation: z.string(),
});
const learningOutcome = z.object({
  code: z.string().regex(/^LO\d+$/),
  description: z.string(),
});

const creditModel = z.object({
  // The three hour fields are the EXPANDED form of the credit model and are
  // OPTIONAL: some handouts give only the short code (AEL ZG631: "3-1-1"),
  // others spell out the hours (the MATLAB sample: "32 Hours of Classroom
  // Instruction + 08 Hours of Tutorials + 88 Hours of Student Preparation").
  // `description` is the canonical, always-present field; the numerics are
  // populated only when the source provides them — we never fabricate hours
  // from a bare ratio code.
  classroomHours: z.number().int().optional(),
  tutorialHours: z.number().int().optional(),
  preparationHours: z.number().int().optional(),
  description: z.string(),
});

const partA = z.object({
  courseTitle: z.string().min(1),
  // No regex on course numbers — the corpus has multiple formats
  // (MTBFZC221, AAOC ZC111, AE ZG510). A real handout can list more than one.
  courseNumbers: z.array(z.string().min(1)).min(1),
  // Optional: real handouts (AEL ZG631) leave the "Credit Units" and
  // "Version No" cells blank. The schema is REPRESENTATIONAL — it accepts a
  // handout that omits these rather than rejecting real data. Surfacing a blank
  // as a faculty-actionable warning is the job of the 11f import pipeline's
  // data-quality report, a separate layer (see docs/dev-handoff-audit.md §5).
  // We never fabricate a value to satisfy a hard requirement a real handout omits.
  creditUnits: z.number().int().positive().optional(),
  creditModel,
  instructors: z.array(z.string()).min(1),
  versionNo: z.number().int().positive().optional(),
  // ISO-ish date string. Kept loose (NOT z.string().date()) because BITS
  // handouts use multiple formats (DD-MM-YYYY is most common). A normalization
  // helper lands with the corpus import pipeline (Prompt 11f) — see
  // docs/dev-handoff-audit.md §5.
  date: z.string(),
  courseDescription: z.string(), // HTML
  laboratoryComponent: z.string().optional(), // HTML, optional
  // Empty arrays accepted (Prompt 11f-b2 — surveyed Module-template imports
  // genuinely lack source COs/LOs; corpus reality contradicts a `min(1)`
  // assumption). Submission-time business rule (≥1 CO and ≥1 LO required
  // before SUBMITTED) lives in submitStructuredForReviewAction + the
  // editor's submit-button tooltip — same shape as the evaluation 100% rule
  // (UI-only enforcement, schema permissive).
  courseObjectives: z.array(courseObjective),
  textBooks: z.array(textBook).min(1),
  referenceBooks: z.array(referenceBook), // may be empty
  learningOutcomes: z.array(learningOutcome),
});

// --- Part B (session plan) ---
const session = z.object({
  // String, not number — Part B combines contact sessions into RANGES
  // ("5-6", "7-8", "12-13" in AEL ZG631). A number can't hold a range, and
  // splitting "5-6" into rows 5 and 6 would fabricate sessions the source does
  // not have (and break references such as "topics from sessions 1-8" that
  // assume the original numbering). Mirrors experimentNumber; sort/format logic
  // can parse the leading digits when an ordering is needed.
  sessionNumber: z.string().min(1),
  topicTitle: z.string(),
  // Variable in the corpus — sometimes a comma-joined list, sometimes a single
  // concept. A single string accommodates both; the renderer may split on
  // commas for display.
  subTopics: z.string(),
  references: z.array(z.string()),
});
const partB = z.object({
  sessions: z.array(session).min(1),
});

// --- Experiential learning ---
const experientialComponent = z.object({
  name: z.string(),
  objective: z.string(),
  outcome: z.string(),
  labInfrastructure: z.string(),
  numberOfExercises: z.string(), // string — sample has non-numeric values like "As per"
  scope: z.string(),
});
const experiment = z.object({
  experimentNumber: z.string(), // string — sample has "6.", "8." (trailing periods)
  title: z.string(),
  moduleReference: z.string(),
});
const experientialLearning = z.object({
  components: z.array(experientialComponent),
  overallObjective: z.string(), // HTML
  overallScope: z.array(z.string()), // bullet list items
  labInfrastructure: z.array(z.string()),
  experiments: z.array(experiment),
});

// --- Evaluation scheme ---
const evaluationSubComponent = z.object({
  name: z.string(),
  type: z.string(),
  weight: z.number().min(0).max(100),
  duration: z.string(),
  scheduledAt: z.string().optional(),
});
const evaluationComponent = z.object({
  ecNumber: z.string(), // e.g. "EC-1"
  subComponents: z.array(evaluationSubComponent),
});
const evaluation = z.object({
  legend: z.string(),
  components: z.array(evaluationComponent),
  notes: z.string(),
  midSemSyllabus: z.string(),
  compreSyllabus: z.string(),
});

const importantLinks = z.object({
  elearnPortalUrl: z.string().url(),
  elearnPortalNote: z.string(),
  contactSessionsNote: z.string(),
});

const metadata = z.object({
  institutionHeader: z.string(),
  divisionHeader: z.string(),
  semester: z.string(),
  documentTitle: z.string(),
  formNumber: z.string(),
});

/** Version 1 of the BITS handout schema. */
export const BitsHandoutSchemaV1 = z.object({
  schemaVersion: z.literal(LATEST_SCHEMA_VERSION),
  metadata,
  partA,
  partB,
  // Optional: validated against the real corpus (385 handouts), a genuine
  // theory course (CC ZG501) has NO experiential section at all — so the whole
  // object may be absent. When present, its inner arrays may still be empty
  // (theory courses that keep the header but list no components/experiments).
  experientialLearning: experientialLearning.optional(),
  evaluation,
  importantLinks,
  evaluationGuidelines: z.string(), // HTML block
});
export type BitsHandoutV1 = z.infer<typeof BitsHandoutSchemaV1>;

/**
 * Discriminated union over all schema versions. Today only V1 exists; future
 * versions are added as new members keyed on `schemaVersion`. Parsing routes to
 * the matching version by its literal discriminant — no implicit upgrades.
 */
export const BitsHandoutSchema = z.discriminatedUnion('schemaVersion', [BitsHandoutSchemaV1]);
export type BitsHandout = z.infer<typeof BitsHandoutSchema>;

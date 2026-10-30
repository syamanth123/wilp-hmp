import { prisma, HandoutStatus, BitsHandoutSchemaV1, type BitsHandoutV1 } from '@hmp/db';
import { extractTiptapText } from '@/lib/handout-versioning';
import { aiFeaturesEnabled } from './features';

export interface ChecklistSignal {
  label: string;
  done: boolean;
  hint?: string;
}

export interface FacultySignals {
  refNo: string;
  requestId: string;
  items: ChecklistSignal[];
}

const ACTIVE_STATUSES: HandoutStatus[] = [
  HandoutStatus.ASSIGNED,
  HandoutStatus.IN_PROGRESS,
  HandoutStatus.REWORK_REQUESTED,
  HandoutStatus.SME_REVIEW,
  HandoutStatus.SUBMITTED,
  HandoutStatus.UNDER_REVIEW,
];

/**
 * Compute submission checklist signals for the faculty's most recently
 * updated active assignment. Returns null if the faculty has no active
 * assignments.
 *
 * Heuristic — signals are derived by:
 *   - Bloom's coverage: AIQualityReport.bloomsJson count of buckets > 0.05
 *   - Text searches: case-insensitive presence of keywords in latest version
 *   - Version count + AI report existence
 */
export async function computeFacultySignals(facultyId: string): Promise<FacultySignals | null> {
  const request = await prisma.handoutRequest.findFirst({
    where: {
      status: { in: ACTIVE_STATUSES },
      assignments: { some: { facultyId, active: true } },
    },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      refNo: true,
      handout: {
        select: {
          id: true,
          currentVersion: { select: { contentJson: true, data: true } },
          versions: { select: { id: true } },
        },
      },
    },
  });
  if (!request) return null;

  const versionCount = request.handout?.versions.length ?? 0;
  const current = request.handout?.currentVersion ?? null;
  // Handouts from the new editor keep their content in `data` (structured);
  // older ones in `contentJson` (TipTap). Read whichever this version has.
  const parsed = current?.data != null ? BitsHandoutSchemaV1.safeParse(current.data) : null;
  const structured = parsed?.success ? structuredSignals(parsed.data) : null;
  const text = current && !structured ? extractTiptapText(current.contentJson).toLowerCase() : '';

  // The Bloom's item needs an AI quality report: only with AI switched on.
  const includeBlooms = aiFeaturesEnabled();
  const latestReport = request.handout
    ? await prisma.aIQualityReport.findFirst({
        where: { handoutId: request.handout.id },
        orderBy: { createdAt: 'desc' },
        select: { bloomsJson: true, coverageJson: true },
      })
    : null;

  const items = buildChecklistItems({
    text,
    versionCount,
    blooms: (latestReport?.bloomsJson ?? null) as Record<string, number> | null,
    coverage: (latestReport?.coverageJson ?? null) as { coverageRatio?: number } | null,
    includeBlooms,
    structured,
  });

  return { refNo: request.refNo, requestId: request.id, items };
}

export interface SignalInputs {
  /** Lower-cased extracted text from the latest handout version. */
  text: string;
  versionCount: number;
  blooms: Record<string, number> | null;
  coverage: { coverageRatio?: number } | null;
  /** Include the Bloom's item (it needs the AI quality check). Default true. */
  includeBlooms?: boolean;
  /** Signals read from a new-editor (structured) handout; replaces the text search. */
  structured?: StructuredSignals | null;
}

export interface StructuredSignals {
  objectives: boolean;
  syllabus: boolean;
  evaluation: boolean;
  references: boolean;
}

/** Text the importer leaves when a field was missing from the Word file. */
const isReal = (text: string | undefined | null) => {
  const t = (text ?? '').replace(/<[^>]*>/g, '').trim();
  return t.length > 0 && !t.toLowerCase().startsWith('(missing');
};

/** Pure: the checklist signals of a structured (new-editor) handout. */
export function structuredSignals(h: BitsHandoutV1): StructuredSignals {
  const weights = h.evaluation.components.flatMap((c) => c.subComponents.map((s) => s.weight));
  const total = weights.reduce((sum, w) => sum + w, 0);
  return {
    objectives:
      h.partA.courseObjectives.some((o) => isReal(o.description)) ||
      h.partA.learningOutcomes.some((o) => isReal(o.description)),
    syllabus: h.partB.sessions.some((s) => isReal(s.topicTitle)),
    evaluation: weights.length > 0 && Math.round(total) === 100,
    references:
      h.partA.textBooks.some((b) => isReal(b.citation)) ||
      h.partA.referenceBooks.some((b) => isReal(b.citation)),
  };
}

/** Pure: derive the checklist from already-loaded inputs. */
export function buildChecklistItems(input: SignalInputs): ChecklistSignal[] {
  const { text, versionCount, blooms, coverage, includeBlooms = true, structured } = input;
  const bloomLevels = blooms
    ? Object.values(blooms).filter((v) => typeof v === 'number' && v >= 0.05).length
    : 0;
  const hasKeyword = (...keywords: string[]) =>
    text.length > 0 && keywords.some((k) => text.includes(k));

  const items: ChecklistSignal[] = [
    {
      label: 'Learning objectives defined',
      done: structured
        ? structured.objectives
        : hasKeyword('objective', 'outcome', 'learning goal'),
      hint: structured
        ? 'Add at least one course objective or learning outcome.'
        : 'Mention objectives, outcomes, or learning goals in the handout.',
    },
    {
      label: 'Syllabus / topics listed',
      done: structured
        ? structured.syllabus
        : (coverage?.coverageRatio ?? 0) > 0 || hasKeyword('syllabus', 'topics', 'modules'),
      hint: structured
        ? 'Add the topics to the course plan.'
        : 'Cover the course syllabus topics or include a topics list.',
    },
    {
      label: 'Evaluation scheme detailed',
      done: structured
        ? structured.evaluation
        : hasKeyword('evaluation', 'assessment', 'grading', 'component'),
      hint: structured
        ? 'Fill in the evaluation scheme so the weights add up to 100%.'
        : 'Describe the evaluation components and weightage.',
    },
    {
      label: 'Reference materials cited',
      done: structured
        ? structured.references
        : hasKeyword('reference', 'textbook', 'reading', 'bibliography'),
      hint: 'List recommended textbooks or references.',
    },
    {
      label: 'Bloom\u2019s coverage across \u22653 levels',
      done: bloomLevels >= 3,
      hint: 'Run the AI quality check; aim for activities across multiple Bloom\u2019s levels.',
    },
    {
      label: 'At least one saved version',
      done: versionCount > 0,
      hint: 'Save a version from the editor.',
    },
  ];
  return includeBlooms ? items : items.filter((i) => !i.label.startsWith('Bloom'));
}

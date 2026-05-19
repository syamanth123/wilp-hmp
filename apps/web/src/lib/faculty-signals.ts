import { prisma, HandoutStatus } from '@hmp/db';
import { extractTiptapText } from '@/lib/handout-versioning';

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
          currentVersion: { select: { contentJson: true } },
          versions: { select: { id: true } },
        },
      },
    },
  });
  if (!request) return null;

  const versionCount = request.handout?.versions.length ?? 0;
  const text = request.handout?.currentVersion
    ? extractTiptapText(request.handout.currentVersion.contentJson).toLowerCase()
    : '';

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
  });

  return { refNo: request.refNo, requestId: request.id, items };
}

export interface SignalInputs {
  /** Lower-cased extracted text from the latest handout version. */
  text: string;
  versionCount: number;
  blooms: Record<string, number> | null;
  coverage: { coverageRatio?: number } | null;
}

/** Pure: derive the checklist from already-loaded inputs. */
export function buildChecklistItems(input: SignalInputs): ChecklistSignal[] {
  const { text, versionCount, blooms, coverage } = input;
  const bloomLevels = blooms
    ? Object.values(blooms).filter((v) => typeof v === 'number' && v >= 0.05).length
    : 0;
  const hasKeyword = (...keywords: string[]) =>
    text.length > 0 && keywords.some((k) => text.includes(k));

  return [
    {
      label: 'Learning objectives defined',
      done: hasKeyword('objective', 'outcome', 'learning goal'),
      hint: 'Mention objectives, outcomes, or learning goals in the handout.',
    },
    {
      label: 'Syllabus / topics listed',
      done: (coverage?.coverageRatio ?? 0) > 0 || hasKeyword('syllabus', 'topics', 'modules'),
      hint: 'Cover the course syllabus topics or include a topics list.',
    },
    {
      label: 'Evaluation scheme detailed',
      done: hasKeyword('evaluation', 'assessment', 'grading', 'component'),
      hint: 'Describe the evaluation components and weightage.',
    },
    {
      label: 'Reference materials cited',
      done: hasKeyword('reference', 'textbook', 'reading', 'bibliography'),
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
}

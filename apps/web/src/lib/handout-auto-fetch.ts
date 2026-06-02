import { Prisma, HandoutStatus, BitsHandoutSchemaV1, type BitsHandoutV1 } from '@hmp/db';

/**
 * Auto-fetch cascade for the structured editor (Prompt 11e). When faculty
 * clicks "Start editing" on a new assignment, this module decides what the
 * initial `HandoutVersion.data` looks like by walking three tiers in order:
 *
 *   1. **Prior version** — most-recent PUBLISHED/ARCHIVED HandoutVersion whose
 *      course matches the current course (canonical or alternateCodes,
 *      symmetric overlap). Metadata stripped (date, instructors, semester,
 *      formNumber, courseNumbers); content preserved (objectives, sessions,
 *      evaluation including 100% weights — faculty must review and confirm).
 *   2. **Corpus import** — currently a stub. Replaced in Prompt 11f when the
 *      HandoutImport table ships.
 *   3. **Empty template** — `blankHandoutForRequest()` from the structured
 *      editor's state module.
 *
 * Source detail strings:
 *   - prior-version: `Prior version: <prior.semesterName> handout for <prior.bitsCourseNumber>`
 *     The prior code is shown explicitly so cross-listing matches are visible
 *     (e.g. a CSI ZC447 faculty inheriting from ES ZC447 sees "for ES ZC447").
 *   - import: `Imported corpus handout: <originalSemester>` (when 11f lands)
 *   - empty: `Empty template`
 *
 * The pure resolver `resolveAutoFetchSource()` takes pre-loaded candidates and
 * decides the tier — testable without a database. The DB wrapper
 * `loadAndResolveAutoFetchSource()` does the symmetric-overlap query then
 * calls the pure function.
 */

import {
  blankHandoutForRequest,
  type RequestContext,
} from '@/app/faculty/assignments/[id]/structured-editor/state';

export type AutoFetchTier = 'prior-version' | 'import' | 'empty';

export interface CourseLite {
  id: string;
  bitsCourseNumber: string;
  alternateCodes: string[];
  title: string;
}

export interface RequestLite {
  id: string;
  course: CourseLite;
  semesterName: string;
  facultyName: string;
}

export interface PriorVersionCandidate {
  versionId: string;
  data: BitsHandoutV1;
  courseBitsNumber: string;
  semesterName: string;
  createdAt: Date;
}

export interface ImportCandidate {
  importId: string;
  data: BitsHandoutV1;
  originalSemesterName: string;
  originalCourseBitsNumber: string;
}

export type ResolvedSource =
  | {
      tier: 'prior-version';
      data: BitsHandoutV1;
      sourceDetail: string;
      versionId: string;
    }
  | {
      tier: 'import';
      data: BitsHandoutV1;
      sourceDetail: string;
      importId: string;
    }
  | {
      tier: 'empty';
      data: BitsHandoutV1;
      sourceDetail: 'Empty template';
    };

/**
 * Reset fields that are semester-specific on a prior version's data before
 * carrying it forward. Content (objectives, books, sessions, evaluation
 * weights) is preserved — faculty must review and confirm the inherited
 * weights against this semester's grading policy.
 */
export function stripIdentifiersForCarryForward(
  prior: BitsHandoutV1,
  request: RequestLite,
): BitsHandoutV1 {
  const todayDdMmYyyy = new Date().toLocaleDateString('en-GB');
  return {
    ...prior,
    metadata: {
      ...prior.metadata,
      semester: request.semesterName,
      formNumber: '',
    },
    partA: {
      ...prior.partA,
      date: todayDdMmYyyy,
      instructors: [request.facultyName],
      courseNumbers: [request.course.bitsCourseNumber, ...request.course.alternateCodes],
    },
  };
}

/**
 * Pure resolver. `priorCandidates` MUST already be filtered (PUBLISHED/ARCHIVED
 * only, symmetric course-code overlap) and sorted (createdAt desc). The DB
 * wrapper enforces both; tests can supply candidates directly.
 */
export function resolveAutoFetchSource(
  request: RequestLite,
  priorCandidates: PriorVersionCandidate[],
  importCandidate: ImportCandidate | null,
): ResolvedSource {
  const top = priorCandidates[0];
  if (top) {
    return {
      tier: 'prior-version',
      data: stripIdentifiersForCarryForward(top.data, request),
      sourceDetail: `Prior version: ${top.semesterName} handout for ${top.courseBitsNumber}`,
      versionId: top.versionId,
    };
  }
  if (importCandidate) {
    return {
      tier: 'import',
      data: stripIdentifiersForCarryForward(importCandidate.data, request),
      sourceDetail: `Imported corpus handout: ${importCandidate.originalSemesterName}`,
      importId: importCandidate.importId,
    };
  }
  const ctx: RequestContext = {
    courseTitle: request.course.title,
    courseNumbers: [request.course.bitsCourseNumber, ...request.course.alternateCodes],
    instructorName: request.facultyName,
    semesterName: request.semesterName,
  };
  return {
    tier: 'empty',
    data: blankHandoutForRequest(ctx),
    sourceDetail: 'Empty template',
  };
}

/**
 * Tier 2 stub. Until Prompt 11f ships the HandoutImport table, this returns
 * null and the cascade falls through to Tier 3 (empty template).
 *
 * TODO(11f): replace with a real lookup against HandoutImport. Query shape
 * mirrors Tier 1's symmetric match on bitsCourseNumber + alternateCodes,
 * restricted to imports flagged "approved for re-use" (the import-approval
 * flag 11f will introduce).
 */
async function findImportForCourse(
  _tx: Prisma.TransactionClient,
  _currentCodes: string[],
): Promise<ImportCandidate | null> {
  return null;
}

/**
 * DB-touching wrapper. Loads prior-version candidates via symmetric overlap
 * on `Course.bitsCourseNumber + alternateCodes`, restricted to
 * PUBLISHED/ARCHIVED handouts (drafts in progress are NOT surfaced), then
 * calls the pure resolver.
 *
 * Symmetric overlap: a prior course matches the current course when any code
 * in the current's `[bitsCourseNumber, ...alternateCodes]` set appears in the
 * prior's `[bitsCourseNumber, ...alternateCodes]` set. Implemented with two
 * OR'd clauses: `bitsCourseNumber IN (currentCodes)` OR
 * `alternateCodes && currentCodes` (Postgres array overlap via `hasSome`).
 *
 * Caller MUST be inside the same transaction as the EDIT_STARTED workflow
 * effects so the cascade lookup + version write are atomic.
 */
export async function loadAndResolveAutoFetchSource(
  tx: Prisma.TransactionClient,
  request: RequestLite,
): Promise<ResolvedSource> {
  const currentCodes = [request.course.bitsCourseNumber, ...request.course.alternateCodes];

  // Symmetric array overlap. The single `handout: { ... }` clause merges
  // the status filter and the nested course-match filter — splitting them
  // into two `handout:` keys would silently drop the status filter (the
  // second key overwrites the first), which would surface drafts-in-progress.
  const candidates = await tx.handoutVersion.findMany({
    where: {
      data: { not: Prisma.JsonNull },
      handout: {
        status: { in: [HandoutStatus.PUBLISHED, HandoutStatus.ARCHIVED] },
        request: {
          offering: {
            course: {
              OR: [
                { bitsCourseNumber: { in: currentCodes } },
                { alternateCodes: { hasSome: currentCodes } },
              ],
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      id: true,
      data: true,
      createdAt: true,
      handout: {
        select: {
          request: {
            select: {
              offering: {
                select: {
                  course: { select: { bitsCourseNumber: true } },
                  semester: { select: { name: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  const priorCandidates: PriorVersionCandidate[] = [];
  for (const row of candidates) {
    const parsed = BitsHandoutSchemaV1.safeParse(row.data);
    if (!parsed.success) continue;
    priorCandidates.push({
      versionId: row.id,
      data: parsed.data,
      courseBitsNumber: row.handout.request.offering.course.bitsCourseNumber,
      semesterName: row.handout.request.offering.semester.name,
      createdAt: row.createdAt,
    });
  }

  const importCandidate = await findImportForCourse(tx, currentCodes);

  return resolveAutoFetchSource(request, priorCandidates, importCandidate);
}

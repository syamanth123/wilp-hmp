import { HandoutStatus, RoleName } from '@hmp/db';

/**
 * Pure export-access gate — the role × status × ownership truth table, kept
 * apart from the route handler so it is unit-testable without HTTP/session.
 * Handout Library decision D1 (docs/plans/handout-library.md §8):
 *
 *   - Approved / published / archived (the library's Published tab): everyone
 *     who can see it may download it.
 *   - In progress — only:
 *       · the faculty member on it (active assignment) once it has been
 *         submitted at least once (SME_REVIEW, SUBMITTED, UNDER_REVIEW,
 *         REWORK_REQUESTED) — before that they work in the editor;
 *       · the Programme Committee (they review it);
 *       · the subject expert assigned to it.
 *   - Draft / rejected requests: nobody.
 *
 * Every download that isn't from the Published tab carries a
 * "DRAFT – not for circulation" mark (see isDraftDownload).
 */

export const PUBLISHED_DOWNLOAD_STATUSES: HandoutStatus[] = [
  HandoutStatus.APPROVED,
  HandoutStatus.PUBLISHED,
  HandoutStatus.ARCHIVED,
];

export const FACULTY_STATUSES: HandoutStatus[] = [
  HandoutStatus.SME_REVIEW,
  HandoutStatus.SUBMITTED,
  HandoutStatus.UNDER_REVIEW,
  HandoutStatus.REWORK_REQUESTED,
];

export const REVIEWER_STATUSES: HandoutStatus[] = [
  HandoutStatus.ALLOCATED,
  HandoutStatus.ASSIGNED,
  HandoutStatus.IN_PROGRESS,
  HandoutStatus.SME_REVIEW,
  HandoutStatus.SUBMITTED,
  HandoutStatus.UNDER_REVIEW,
  HandoutStatus.REWORK_REQUESTED,
];

export interface ExportAccessInput {
  roles: RoleName[];
  status: HandoutStatus;
  /** True when the requesting user has an ACTIVE FacultyAssignment for this request. */
  isOwnerFaculty: boolean;
  /** True when the requesting user is the SME assigned to this request. */
  isAssignedSme?: boolean;
}

export function canExportHandout({
  roles,
  status,
  isOwnerFaculty,
  isAssignedSme = false,
}: ExportAccessInput): boolean {
  if (PUBLISHED_DOWNLOAD_STATUSES.includes(status)) return roles.length > 0;
  if (isOwnerFaculty && FACULTY_STATUSES.includes(status)) return true;
  if (!REVIEWER_STATUSES.includes(status)) return false;
  return roles.includes(RoleName.PROGRAMME_COMMITTEE) || isAssignedSme;
}

/** Downloads of anything not in the Published tab are marked "DRAFT – not for circulation". */
export function isDraftDownload(status: HandoutStatus): boolean {
  return !PUBLISHED_DOWNLOAD_STATUSES.includes(status);
}

export const DRAFT_MARK_TEXT = 'DRAFT – not for circulation';

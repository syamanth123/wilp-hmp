import { HandoutStatus, RoleName } from '@hmp/db';

/**
 * Pure export-access gate (Prompt 23-b, the 1F matrix made code-precise).
 * Separated from the route handler so the role × status × ownership truth
 * table is unit-testable without HTTP/session.
 *
 *   - IC / HOG / Admin: any handout at APPROVED or PUBLISHED.
 *   - Faculty: their OWN handout (active assignment) once it has been submitted
 *     at least once — status ∈ {SME_REVIEW, SUBMITTED, UNDER_REVIEW,
 *     REWORK_REQUESTED, APPROVED, PUBLISHED}. Pre-submit (REQUESTED, ALLOCATED,
 *     ASSIGNED, initial IN_PROGRESS) is excluded — they see it in the editor.
 *   - PC / SME and everyone else: no download.
 */

export const PRIVILEGED_ROLES: RoleName[] = [
  RoleName.INSTRUCTION_CELL,
  RoleName.HOG,
  RoleName.ADMIN,
];

export const PRIVILEGED_STATUSES: HandoutStatus[] = [
  HandoutStatus.APPROVED,
  HandoutStatus.PUBLISHED,
];

export const FACULTY_STATUSES: HandoutStatus[] = [
  HandoutStatus.SME_REVIEW,
  HandoutStatus.SUBMITTED,
  HandoutStatus.UNDER_REVIEW,
  HandoutStatus.REWORK_REQUESTED,
  HandoutStatus.APPROVED,
  HandoutStatus.PUBLISHED,
];

export interface ExportAccessInput {
  roles: RoleName[];
  status: HandoutStatus;
  /** True when the requesting user has an ACTIVE FacultyAssignment for this request. */
  isOwnerFaculty: boolean;
}

export function canExportHandout({ roles, status, isOwnerFaculty }: ExportAccessInput): boolean {
  const privileged =
    roles.some((r) => PRIVILEGED_ROLES.includes(r)) && PRIVILEGED_STATUSES.includes(status);
  const ownerFaculty = isOwnerFaculty && FACULTY_STATUSES.includes(status);
  return privileged || ownerFaculty;
}

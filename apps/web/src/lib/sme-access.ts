import { RoleName } from '@hmp/db';

/**
 * Who may open the SME review page for a handout (/sme/review/[id]).
 *
 *   - ADMIN: any handout (unchanged — admins pass every role check).
 *   - SME: only a handout they are the assigned SME for.
 *   - Anyone else: no (the page's requireRole already refuses them).
 *
 * Before this rule the page rendered the full handout, attachments and
 * discussion for ANY signed-in SME and only hid the decision panel.
 */
export interface SmeViewInput {
  roles: RoleName[];
  userId: string;
  /** SmeAssignment.smeUserId for the request, or null when none exists. */
  assignedSmeUserId: string | null | undefined;
}

export function canOpenSmeReview({ roles, userId, assignedSmeUserId }: SmeViewInput): boolean {
  if (roles.includes(RoleName.ADMIN)) return true;
  if (!roles.includes(RoleName.SME)) return false;
  return assignedSmeUserId != null && assignedSmeUserId === userId;
}

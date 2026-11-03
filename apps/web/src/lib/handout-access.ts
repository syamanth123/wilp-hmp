import { HandoutStatus, Prisma, RoleName, prisma } from '@hmp/db';
import type { SessionUser } from '@hmp/auth';

/**
 * Who may see which handout in the Handout Library — ONE rule, used by every list, count, facet,
 * suggestion, export, detail page and download (never only hidden in the UI).
 *
 *   Published tab (approved / published / archived)   every role
 *   In progress tab                                    Admin, IC, HOG, PC: all
 *                                                      Faculty: only with their ACTIVE assignment
 *                                                      SME: only those assigned to them
 *   Draft / rejected requests                          Admin, IC, HOG, PC only
 *   Past BITS handouts (approved imports with data)    every role
 *
 * HMP has no programme ↔ person link, so HOG and PC see every programme's handouts.
 */

const S = HandoutStatus;

export const PUBLISHED_STATUSES: HandoutStatus[] = [S.APPROVED, S.PUBLISHED, S.ARCHIVED];
export const IN_PROGRESS_STATUSES: HandoutStatus[] = [
  S.REQUESTED,
  S.ALLOCATED,
  S.ASSIGNED,
  S.IN_PROGRESS,
  S.SME_REVIEW,
  S.SUBMITTED,
  S.UNDER_REVIEW,
  S.REWORK_REQUESTED,
];
/** Never-started drafts and rejected requests: oversight roles only. */
export const OVERSIGHT_ONLY_STATUSES: HandoutStatus[] = [S.DRAFT, S.REJECTED];

const OVERSIGHT_ROLES: RoleName[] = [
  RoleName.ADMIN,
  RoleName.INSTRUCTION_CELL,
  RoleName.HOG,
  RoleName.PROGRAMME_COMMITTEE,
];

export type LibraryTab = 'published' | 'in-progress';

type ScopeUser = Pick<SessionUser, 'id' | 'roles'>;

export function seesAllWork(user: ScopeUser): boolean {
  return user.roles.some((r) => OVERSIGHT_ROLES.includes(r));
}

/** The requests a faculty member / SME is personally on (their own work). */
function ownWork(user: ScopeUser): Prisma.HandoutRequestWhereInput[] {
  const own: Prisma.HandoutRequestWhereInput[] = [];
  if (user.roles.includes(RoleName.FACULTY)) {
    own.push({ assignments: { some: { facultyId: user.id, active: true } } });
  }
  if (user.roles.includes(RoleName.SME)) {
    own.push({ smeAssignment: { is: { smeUserId: user.id } } });
  }
  return own;
}

/** Where-clause for one library tab, for this user. Matches nothing when the user may see nothing. */
export function libraryScope(user: ScopeUser, tab: LibraryTab): Prisma.HandoutRequestWhereInput {
  if (tab === 'published') return { status: { in: PUBLISHED_STATUSES } };
  if (seesAllWork(user)) {
    return { status: { in: [...IN_PROGRESS_STATUSES, ...OVERSIGHT_ONLY_STATUSES] } };
  }
  const own = ownWork(user);
  if (own.length === 0) return { id: { in: [] } };
  return { status: { in: IN_PROGRESS_STATUSES }, OR: own };
}

/** Everything this user may see in the library (both tabs). */
export function anyLibraryScope(user: ScopeUser): Prisma.HandoutRequestWhereInput {
  return { OR: [libraryScope(user, 'published'), libraryScope(user, 'in-progress')] };
}

/** Past BITS handouts: only admin-approved imports that parsed into a handout. */
export const PAST_HANDOUT_SCOPE: Prisma.HandoutImportWhereInput = {
  approvedForReuse: true,
  data: { not: Prisma.DbNull },
};

/** For the detail page and downloads: may this user open this request? */
export async function canViewHandout(user: ScopeUser, requestId: string): Promise<boolean> {
  const n = await prisma.handoutRequest.count({
    where: { AND: [{ id: requestId }, anyLibraryScope(user)] },
  });
  return n > 0;
}

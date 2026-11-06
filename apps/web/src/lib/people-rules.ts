import { RoleName } from '@hmp/db';

/**
 * The Instruction Cell's limits on People (v1.4.0) — no server or session imports here, so the
 * upload preview and tests can use them. The IC can't change an Admin account and can't give the
 * Admin role; an Admin can do both.
 */
export const ADMIN_ACCOUNT_MESSAGE =
  'Only an Admin can change an Admin account. Leave it as it is, or ask an Admin.';
export const ADMIN_ROLE_MESSAGE = 'Only an Admin can give the Admin role.';

/**
 * Why this change isn't the IC's to make — or null when it is (always null for an Admin).
 * `before` is the person's current roles (null for someone new); `after` the roles being saved.
 */
export function adminOnlyProblem(
  actorIsAdmin: boolean,
  before: RoleName[] | null,
  after: RoleName[],
): string | null {
  if (actorIsAdmin) return null;
  if (before?.includes(RoleName.ADMIN)) return ADMIN_ACCOUNT_MESSAGE;
  if (after.includes(RoleName.ADMIN)) return ADMIN_ROLE_MESSAGE;
  return null;
}

import { prisma } from './index';

/**
 * The canonical "usable account" filter (Prompt 18). A user is soft-deleted /
 * disabled via `active = false` — there is NO `deletedAt` column (it was dead
 * scaffolding, dropped in Prompt 18). Spread this into the `where` of any query
 * that must exclude disabled users (rosters, allocation pickers, notification
 * recipients):
 *
 *   prisma.user.findMany({ where: { ...ACTIVE_USER_FILTER, roles: { ... } } })
 *
 * It is a spreadable CONSTANT rather than a query wrapper on purpose: a wrapper
 * returning a fixed `User` shape would discard each caller's narrowed `select`
 * type. The constant composes with every query's existing select/include/orderBy.
 *
 * NOT applied at: auth (loads by email then checks `!user.active` — a different
 * idiom), the admin user list (must show all users to toggle them), and
 * historical displays (audit log, AI metrics — disabled users must still render
 * their names). See docs/dev-handoff-audit.md §1.
 */
export const ACTIVE_USER_FILTER = { active: true } as const;

/**
 * Action-layer guard: load a user by id that MUST be active, else throw. Use in
 * server actions that operate on a specific user and must reject a disabled one.
 * Returns the full row (no narrowed select — that's the intended use case).
 */
export async function requireActiveUser(id: string) {
  const user = await prisma.user.findFirst({ where: { id, ...ACTIVE_USER_FILTER } });
  if (!user) throw new Error('user_not_found_or_inactive');
  return user;
}

import { RoleName } from '@hmp/db';
import type { SessionUser } from '@hmp/auth';

/**
 * Pick the landing route based on the user's highest-privilege role.
 * Order: ADMIN > INSTRUCTION_CELL > HOG > PROGRAMME_COMMITTEE > FACULTY
 */
export function defaultRouteForUser(user: SessionUser): string {
  if (user.roles.includes(RoleName.ADMIN)) return '/admin';
  if (user.roles.includes(RoleName.INSTRUCTION_CELL)) return '/ic';
  if (user.roles.includes(RoleName.HOG)) return '/hog';
  if (user.roles.includes(RoleName.PROGRAMME_COMMITTEE)) return '/pc';
  if (user.roles.includes(RoleName.FACULTY)) return '/faculty';
  return '/login';
}

export const ROLE_AREAS: Record<string, RoleName[]> = {
  '/admin': [RoleName.ADMIN],
  '/ic': [RoleName.INSTRUCTION_CELL, RoleName.ADMIN],
  '/hog': [RoleName.HOG, RoleName.ADMIN],
  '/pc': [RoleName.PROGRAMME_COMMITTEE, RoleName.ADMIN],
  '/faculty': [RoleName.FACULTY, RoleName.ADMIN],
};

export function isAllowed(user: SessionUser, pathname: string): boolean {
  const area = Object.keys(ROLE_AREAS).find((p) => pathname === p || pathname.startsWith(p + '/'));
  if (!area) return true;
  const allowed = ROLE_AREAS[area];
  if (!allowed) return true;
  return allowed.some((r) => user.roles.includes(r));
}

import { describe, it, expect } from 'vitest';
import { RoleName } from '@hmp/db';
import {
  hasPermission,
  requirePermission,
  AuthorizationError,
  AuthenticationError,
  type SessionUser,
} from './rbac';

function buildUser(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: 'u1',
    email: 'test@hmp.local',
    name: 'Test User',
    roles: [],
    permissions: [],
    ...overrides,
  };
}

describe('hasPermission', () => {
  it('returns true when the user has a role granting the permission (key is in user.permissions)', () => {
    const user = buildUser({
      roles: [RoleName.SME],
      permissions: ['handout.advise', 'handout.read', 'comment.write'],
    });
    expect(hasPermission(user, 'handout.advise')).toBe(true);
  });

  it('returns false when the user lacks any granting role (key is not in user.permissions)', () => {
    const user = buildUser({
      roles: [RoleName.FACULTY],
      permissions: ['handout.read', 'handout.edit'],
    });
    expect(hasPermission(user, 'handout.advise')).toBe(false);
  });

  it('returns true for an ADMIN regardless of explicit grants (super-role bypass)', () => {
    // Even with an empty permissions array, ADMIN gets through. This matches
    // hasRole()'s ADMIN bypass; the two helpers are intentionally symmetric.
    const admin = buildUser({ roles: [RoleName.ADMIN], permissions: [] });
    expect(hasPermission(admin, 'handout.advise')).toBe(true);
    expect(hasPermission(admin, 'arbitrary.key.not.in.system')).toBe(true);
  });

  it('returns false for null / undefined user (unauthenticated)', () => {
    expect(hasPermission(null, 'handout.advise')).toBe(false);
    expect(hasPermission(undefined, 'handout.advise')).toBe(false);
  });
});

describe('requirePermission', () => {
  it('returns the user when the permission is granted', () => {
    const user = buildUser({
      roles: [RoleName.SME],
      permissions: ['handout.advise'],
    });
    expect(requirePermission(user, 'handout.advise')).toBe(user);
  });

  it('returns the user when the user is ADMIN (super-role bypass)', () => {
    const admin = buildUser({ roles: [RoleName.ADMIN], permissions: [] });
    expect(requirePermission(admin, 'handout.advise')).toBe(admin);
  });

  it('throws AuthorizationError when the permission is missing', () => {
    const user = buildUser({
      roles: [RoleName.FACULTY],
      permissions: ['handout.edit'],
    });
    expect(() => requirePermission(user, 'handout.advise')).toThrow(AuthorizationError);
    // The error message should name the missing key so server logs are
    // actionable.
    try {
      requirePermission(user, 'handout.advise');
    } catch (err) {
      expect(err).toBeInstanceOf(AuthorizationError);
      expect((err as Error).message).toContain('handout.advise');
    }
  });

  it('throws AuthenticationError when the user is null / undefined', () => {
    expect(() => requirePermission(null, 'handout.advise')).toThrow(AuthenticationError);
    expect(() => requirePermission(undefined, 'handout.advise')).toThrow(AuthenticationError);
  });
});

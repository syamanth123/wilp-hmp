import { describe, it, expect } from 'vitest';
import { RoleName } from '@hmp/db';
import { defaultRouteForUser, isAllowed } from './routing';
import type { SessionUser } from '@hmp/auth';

const make = (roles: RoleName[]): SessionUser => ({
  id: 'u1',
  email: 'u@x',
  name: 'U',
  roles,
  permissions: [],
});

describe('routing', () => {
  it('routes admins to /admin', () => {
    expect(defaultRouteForUser(make([RoleName.ADMIN]))).toBe('/admin');
  });
  it('routes faculty to /faculty', () => {
    expect(defaultRouteForUser(make([RoleName.FACULTY]))).toBe('/faculty');
  });
  it('blocks faculty from /admin', () => {
    expect(isAllowed(make([RoleName.FACULTY]), '/admin')).toBe(false);
  });
  it('admins can access any area', () => {
    expect(isAllowed(make([RoleName.ADMIN]), '/faculty')).toBe(true);
    expect(isAllowed(make([RoleName.ADMIN]), '/hog')).toBe(true);
  });
  it('HOG cannot access PC area', () => {
    expect(isAllowed(make([RoleName.HOG]), '/pc')).toBe(false);
  });
});

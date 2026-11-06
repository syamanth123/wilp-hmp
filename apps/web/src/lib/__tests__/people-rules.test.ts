import { describe, expect, it } from 'vitest';
import { RoleName } from '@hmp/db';
import { ADMIN_ACCOUNT_MESSAGE, ADMIN_ROLE_MESSAGE, adminOnlyProblem } from '../people-rules';

// v1.4.0: the Instruction Cell manages People, but not Admin accounts or the Admin role.
describe('adminOnlyProblem', () => {
  const { ADMIN, INSTRUCTION_CELL, FACULTY, HOG } = RoleName;

  it('an Admin may do anything', () => {
    expect(adminOnlyProblem(true, [ADMIN], [FACULTY])).toBeNull();
    expect(adminOnlyProblem(true, [FACULTY], [FACULTY, ADMIN])).toBeNull();
    expect(adminOnlyProblem(true, null, [ADMIN])).toBeNull();
  });

  it('the IC manages everyone else, including other IC and HOG accounts', () => {
    expect(adminOnlyProblem(false, [FACULTY], [FACULTY, HOG])).toBeNull();
    expect(adminOnlyProblem(false, [INSTRUCTION_CELL], [INSTRUCTION_CELL])).toBeNull();
    expect(adminOnlyProblem(false, null, [FACULTY])).toBeNull();
  });

  it('the IC can’t change an Admin account, or give or remove the Admin role', () => {
    expect(adminOnlyProblem(false, [ADMIN], [ADMIN])).toBe(ADMIN_ACCOUNT_MESSAGE);
    expect(adminOnlyProblem(false, [ADMIN, FACULTY], [FACULTY])).toBe(ADMIN_ACCOUNT_MESSAGE);
    expect(adminOnlyProblem(false, [FACULTY], [FACULTY, ADMIN])).toBe(ADMIN_ROLE_MESSAGE);
    expect(adminOnlyProblem(false, null, [ADMIN])).toBe(ADMIN_ROLE_MESSAGE);
  });
});

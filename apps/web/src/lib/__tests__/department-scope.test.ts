import { describe, expect, it } from 'vitest';
import { RoleName } from '@hmp/db';
import {
  DEPARTMENT_UNKNOWN,
  departmentScope,
  inDepartment,
  personallyOn,
  requestInScope,
  seesAllForMissingDepartment,
} from '../department-scope';

// v1.4.1 §C — the one scoping rule, as a role × department matrix.
const { ADMIN, INSTRUCTION_CELL, HOG, PROGRAMME_COMMITTEE, FACULTY } = RoleName;
const CSIS = 'dept-csis';
const EEE = 'dept-eee';
const who = (roles: RoleName[], departmentId: string | null = CSIS) => ({
  id: 'u1',
  roles,
  departmentId,
});

describe('departmentScope (the where-clause)', () => {
  it('IC and Admin: no limit, whatever their department', () => {
    expect(departmentScope(who([INSTRUCTION_CELL]))).toBeNull();
    expect(departmentScope(who([ADMIN], null))).toBeNull();
    expect(departmentScope(who([HOG, INSTRUCTION_CELL]))).toBeNull();
  });
  it('HOG / PC with a department: theirs + department unknown + their own requests', () => {
    for (const role of [HOG, PROGRAMME_COMMITTEE])
      expect(departmentScope(who([role]))).toEqual({
        OR: [inDepartment(CSIS), DEPARTMENT_UNKNOWN, personallyOn('u1')],
      });
  });
  it('H9: HOG / PC with no department set: no limit (and they are told)', () => {
    expect(departmentScope(who([HOG], null))).toBeNull();
    expect(seesAllForMissingDepartment(who([HOG], null))).toBe(true);
    expect(seesAllForMissingDepartment(who([PROGRAMME_COMMITTEE], null))).toBe(true);
    expect(seesAllForMissingDepartment(who([HOG]))).toBe(false);
    expect(seesAllForMissingDepartment(who([INSTRUCTION_CELL], null))).toBe(false);
    expect(seesAllForMissingDepartment(who([FACULTY], null))).toBe(false);
  });
});

describe('requestInScope (one loaded request)', () => {
  const req = (departmentId: string | null, assigneeIds: string[] = []) => ({
    departmentId,
    assigneeIds,
  });
  const cases: [string, ReturnType<typeof who>, ReturnType<typeof req>, boolean][] = [
    ['CSIS HOG, CSIS request', who([HOG]), req(CSIS), true],
    ['CSIS HOG, EEE request', who([HOG]), req(EEE), false],
    ['CSIS PC, EEE request', who([PROGRAMME_COMMITTEE]), req(EEE), false],
    ['CSIS HOG, EEE request they are on', who([HOG]), req(EEE, ['u1']), true],
    ['H10: department unknown → every HOG', who([HOG]), req(null), true],
    ['H9: HOG with no department → everything', who([HOG], null), req(EEE), true],
    ['IC → everything', who([INSTRUCTION_CELL], null), req(EEE), true],
    ['Admin → everything', who([ADMIN]), req(EEE), true],
  ];
  for (const [label, u, r, expected] of cases)
    it(label, () => expect(requestInScope(u, r)).toBe(expected));
});

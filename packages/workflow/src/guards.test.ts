import { describe, it, expect } from 'vitest';
import { FacultyType, RoleName, HandoutStatus } from '@hmp/db';
import {
  WorkflowError,
  assertRoleAllowed,
  assertOffCampusCap,
  assertStatus,
} from './guards';

describe('workflow guards', () => {
  it('allows IC to initiate a request', () => {
    expect(() => assertRoleAllowed('REQUEST_INITIATED', [RoleName.INSTRUCTION_CELL])).not.toThrow();
  });

  it('blocks faculty from allocating', () => {
    expect(() => assertRoleAllowed('FACULTY_ALLOCATED', [RoleName.FACULTY])).toThrow(WorkflowError);
  });

  it('ADMIN bypass allows any event', () => {
    expect(() => assertRoleAllowed('PUBLISHED', [RoleName.ADMIN])).not.toThrow();
  });

  it('off-campus cap throws at threshold', () => {
    expect(() =>
      assertOffCampusCap({ facultyType: FacultyType.OFF_CAMPUS, activeAssignmentsInSemester: 3 }, 3),
    ).toThrow(WorkflowError);
  });

  it('on-campus faculty is exempt from cap', () => {
    expect(() =>
      assertOffCampusCap({ facultyType: FacultyType.ON_CAMPUS, activeAssignmentsInSemester: 10 }, 3),
    ).not.toThrow();
  });

  it('assertStatus accepts allowed and rejects others', () => {
    expect(() => assertStatus(HandoutStatus.SUBMITTED, [HandoutStatus.SUBMITTED])).not.toThrow();
    expect(() => assertStatus(HandoutStatus.DRAFT, [HandoutStatus.SUBMITTED])).toThrow(WorkflowError);
  });
});

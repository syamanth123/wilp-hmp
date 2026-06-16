import { describe, it, expect } from 'vitest';
import { FacultyType, RoleName, HandoutStatus } from '@hmp/db';
import { WorkflowError, assertRoleAllowed, assertOffCampusCap, assertStatus } from './guards';

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
      assertOffCampusCap(
        { facultyType: FacultyType.OFF_CAMPUS, activeAssignmentsInSemester: 3 },
        3,
      ),
    ).toThrow(WorkflowError);
  });

  it('on-campus faculty is exempt from cap', () => {
    expect(() =>
      assertOffCampusCap(
        { facultyType: FacultyType.ON_CAMPUS, activeAssignmentsInSemester: 10 },
        3,
      ),
    ).not.toThrow();
  });

  it('assertStatus accepts allowed and rejects others', () => {
    expect(() => assertStatus(HandoutStatus.SUBMITTED, [HandoutStatus.SUBMITTED])).not.toThrow();
    expect(() => assertStatus(HandoutStatus.DRAFT, [HandoutStatus.SUBMITTED])).toThrow(
      WorkflowError,
    );
  });

  // Prompt 12-a: SME workflow role gates.
  it('allows the SME to fire approve/revert; blocks others', () => {
    expect(() => assertRoleAllowed('SME_APPROVED', [RoleName.SME])).not.toThrow();
    expect(() => assertRoleAllowed('SME_REVERTED', [RoleName.SME])).not.toThrow();
    expect(() => assertRoleAllowed('SME_APPROVED', [RoleName.PROGRAMME_COMMITTEE])).toThrow(
      WorkflowError,
    );
    expect(() => assertRoleAllowed('SME_REVERTED', [RoleName.FACULTY])).toThrow(WorkflowError);
  });

  it('allows faculty to request SME review (their submit); blocks SME from firing it', () => {
    expect(() => assertRoleAllowed('SME_REVIEW_REQUESTED', [RoleName.FACULTY])).not.toThrow();
    expect(() => assertRoleAllowed('SME_REVIEW_REQUESTED', [RoleName.SME])).toThrow(WorkflowError);
  });

  // Prompt 22: only PC may reject an allocation.
  it('allows PC to reject an allocation; blocks HOG/faculty', () => {
    expect(() =>
      assertRoleAllowed('ALLOCATION_REJECTED', [RoleName.PROGRAMME_COMMITTEE]),
    ).not.toThrow();
    expect(() => assertRoleAllowed('ALLOCATION_REJECTED', [RoleName.HOG])).toThrow(WorkflowError);
    expect(() => assertRoleAllowed('ALLOCATION_REJECTED', [RoleName.FACULTY])).toThrow(
      WorkflowError,
    );
  });
});

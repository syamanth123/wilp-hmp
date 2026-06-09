import type { HandoutStatus} from '@hmp/db';
import { FacultyType, RoleName } from '@hmp/db';
import type { WorkflowEvent } from './types';

/**
 * Map workflow event -> role(s) authorized to invoke it.
 * ADMIN may invoke any transition (escape hatch).
 */
export const EVENT_ROLE_MATRIX: Record<WorkflowEvent['type'], RoleName[]> = {
  REQUEST_INITIATED: [RoleName.INSTRUCTION_CELL],
  FACULTY_ALLOCATED: [RoleName.HOG],
  ASSIGNED: [RoleName.PROGRAMME_COMMITTEE],
  EDIT_STARTED: [RoleName.FACULTY],
  SUBMITTED: [RoleName.FACULTY],
  // Prompt 12-a (SME approval workflow). Faculty fires SME_REVIEW_REQUESTED
  // (their submit, routed to SME when an SmeAssignment exists). The SME
  // fires the approve/revert decisions.
  SME_REVIEW_REQUESTED: [RoleName.FACULTY],
  SME_APPROVED: [RoleName.SME],
  SME_REVERTED: [RoleName.SME],
  REVIEW_REWORK: [RoleName.PROGRAMME_COMMITTEE, RoleName.HOG],
  REVIEW_APPROVED: [RoleName.PROGRAMME_COMMITTEE],
  FINAL_APPROVED: [RoleName.HOG],
  FINAL_REJECTED: [RoleName.HOG],
  PUBLISHED: [RoleName.INSTRUCTION_CELL],
  ARCHIVED: [RoleName.INSTRUCTION_CELL, RoleName.ADMIN],
};

export class WorkflowError extends Error {
  status = 400 as const;
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'WorkflowError';
    this.code = code;
  }
}

export function assertRoleAllowed(event: WorkflowEvent['type'], roles: RoleName[]) {
  if (roles.includes(RoleName.ADMIN)) return;
  const allowed = EVENT_ROLE_MATRIX[event] ?? [];
  if (!allowed.some((r) => roles.includes(r))) {
    throw new WorkflowError('forbidden', `Your role cannot invoke ${event}`);
  }
}

/**
 * Off-campus / adjunct faculty can be assigned at most N active courses per semester.
 * Returns the number of active assignments the faculty already holds in the same semester.
 */
export interface FacultyLoad {
  facultyType: FacultyType | null;
  activeAssignmentsInSemester: number;
}

export function assertOffCampusCap(load: FacultyLoad, cap: number) {
  const isCapped =
    load.facultyType === FacultyType.OFF_CAMPUS ||
    load.facultyType === FacultyType.ADJUNCT ||
    load.facultyType === FacultyType.GUEST;
  if (!isCapped) return;
  if (load.activeAssignmentsInSemester >= cap) {
    throw new WorkflowError(
      'off_campus_cap_exceeded',
      `Off-campus/adjunct faculty cannot exceed ${cap} courses per semester (current: ${load.activeAssignmentsInSemester}).`,
    );
  }
}

/**
 * Status sanity guard — extra check on top of the transition table.
 * Used by callers that want explicit error messaging.
 */
export function assertStatus(current: HandoutStatus, allowed: HandoutStatus[]) {
  if (!allowed.includes(current)) {
    throw new WorkflowError(
      'invalid_status',
      `Action not allowed from status ${current}. Expected one of: ${allowed.join(', ')}.`,
    );
  }
}

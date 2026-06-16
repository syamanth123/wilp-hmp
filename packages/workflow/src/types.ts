import type { HandoutStatus } from '@hmp/db';

export type WorkflowEvent =
  | { type: 'REQUEST_INITIATED'; actorId: string }
  | { type: 'FACULTY_ALLOCATED'; actorId: string; facultyIds: string[] }
  | { type: 'ASSIGNED'; actorId: string }
  // Prompt 22: PC rejects HOG's allocation (ALLOCATED → REQUESTED). Comment
  // required; the reject effect clears the FacultyAssignment + SmeAssignment so
  // HOG re-allocates from scratch. Complements the existing ASSIGNED confirm
  // edge — together they make PC's allocation-review gate confirm-OR-reject.
  | { type: 'ALLOCATION_REJECTED'; actorId: string; comments: string }
  | { type: 'EDIT_STARTED'; actorId: string }
  | { type: 'SUBMITTED'; actorId: string }
  // Prompt 12-a (SME approval workflow). Faculty submit routes here when an
  // SmeAssignment exists (opt-in in 12-a; default in 12-b). SME then either
  // approves (→ SUBMITTED, PC's queue) or reverts (→ REWORK_REQUESTED).
  | { type: 'SME_REVIEW_REQUESTED'; actorId: string }
  | { type: 'SME_APPROVED'; actorId: string }
  | { type: 'SME_REVERTED'; actorId: string; comments: string }
  | { type: 'REVIEW_REWORK'; actorId: string; comments: string }
  | { type: 'REVIEW_APPROVED'; actorId: string }
  | { type: 'FINAL_APPROVED'; actorId: string }
  | { type: 'FINAL_REJECTED'; actorId: string; reason: string }
  | { type: 'PUBLISHED'; actorId: string }
  | { type: 'ARCHIVED'; actorId: string };

export interface WorkflowContext {
  requestId: string;
  status: HandoutStatus;
}

export type WorkflowTransition = {
  from: HandoutStatus;
  on: WorkflowEvent['type'];
  to: HandoutStatus;
};

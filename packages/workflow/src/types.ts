import type { HandoutStatus } from '@hmp/db';

export type WorkflowEvent =
  | { type: 'REQUEST_INITIATED'; actorId: string }
  | { type: 'FACULTY_ALLOCATED'; actorId: string; facultyIds: string[] }
  | { type: 'ASSIGNED'; actorId: string }
  | { type: 'EDIT_STARTED'; actorId: string }
  | { type: 'SUBMITTED'; actorId: string }
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

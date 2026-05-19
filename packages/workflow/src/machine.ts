import { setup } from 'xstate';
import { HandoutStatus } from '@hmp/db';

/**
 * Handout lifecycle state machine.
 * Source of truth for valid transitions. M3+ wires these to DB mutations + side effects.
 */
export const handoutMachine = setup({
  types: {
    context: {} as { requestId: string },
    events: {} as
      | { type: 'REQUEST_INITIATED' }
      | { type: 'FACULTY_ALLOCATED' }
      | { type: 'ASSIGNED' }
      | { type: 'EDIT_STARTED' }
      | { type: 'SUBMITTED' }
      | { type: 'REVIEW_REWORK' }
      | { type: 'REVIEW_APPROVED' }
      | { type: 'FINAL_APPROVED' }
      | { type: 'FINAL_REJECTED' }
      | { type: 'PUBLISHED' }
      | { type: 'ARCHIVED' },
  },
}).createMachine({
  id: 'handout',
  initial: 'DRAFT',
  context: ({ input }) => ({ requestId: (input as { requestId: string }).requestId }),
  states: {
    DRAFT: { on: { REQUEST_INITIATED: 'REQUESTED' } },
    REQUESTED: { on: { FACULTY_ALLOCATED: 'ALLOCATED' } },
    ALLOCATED: { on: { ASSIGNED: 'ASSIGNED' } },
    ASSIGNED: { on: { EDIT_STARTED: 'IN_PROGRESS' } },
    IN_PROGRESS: { on: { SUBMITTED: 'SUBMITTED' } },
    SUBMITTED: { on: { REVIEW_REWORK: 'REWORK_REQUESTED', REVIEW_APPROVED: 'UNDER_REVIEW' } },
    UNDER_REVIEW: {
      on: {
        FINAL_APPROVED: 'APPROVED',
        FINAL_REJECTED: 'REJECTED',
        REVIEW_REWORK: 'REWORK_REQUESTED',
      },
    },
    REWORK_REQUESTED: { on: { SUBMITTED: 'SUBMITTED' } },
    APPROVED: { on: { PUBLISHED: 'PUBLISHED' } },
    PUBLISHED: { on: { ARCHIVED: 'ARCHIVED' } },
    ARCHIVED: { type: 'final' },
    REJECTED: { type: 'final' },
  },
});

/**
 * Pure transition lookup, useful for guards and tests without instantiating an actor.
 */
const TRANSITIONS: Record<HandoutStatus, Partial<Record<string, HandoutStatus>>> = {
  [HandoutStatus.DRAFT]: { REQUEST_INITIATED: HandoutStatus.REQUESTED },
  [HandoutStatus.REQUESTED]: { FACULTY_ALLOCATED: HandoutStatus.ALLOCATED },
  [HandoutStatus.ALLOCATED]: { ASSIGNED: HandoutStatus.ASSIGNED },
  [HandoutStatus.ASSIGNED]: { EDIT_STARTED: HandoutStatus.IN_PROGRESS },
  [HandoutStatus.IN_PROGRESS]: { SUBMITTED: HandoutStatus.SUBMITTED },
  [HandoutStatus.SUBMITTED]: {
    REVIEW_REWORK: HandoutStatus.REWORK_REQUESTED,
    REVIEW_APPROVED: HandoutStatus.UNDER_REVIEW,
  },
  [HandoutStatus.UNDER_REVIEW]: {
    FINAL_APPROVED: HandoutStatus.APPROVED,
    FINAL_REJECTED: HandoutStatus.REJECTED,
    REVIEW_REWORK: HandoutStatus.REWORK_REQUESTED,
  },
  [HandoutStatus.REWORK_REQUESTED]: { SUBMITTED: HandoutStatus.SUBMITTED },
  [HandoutStatus.APPROVED]: { PUBLISHED: HandoutStatus.PUBLISHED },
  [HandoutStatus.PUBLISHED]: { ARCHIVED: HandoutStatus.ARCHIVED },
  [HandoutStatus.ARCHIVED]: {},
  [HandoutStatus.REJECTED]: {},
};

export function nextStatus(current: HandoutStatus, event: string): HandoutStatus | null {
  return TRANSITIONS[current]?.[event] ?? null;
}

export function canTransition(current: HandoutStatus, event: string): boolean {
  return nextStatus(current, event) !== null;
}

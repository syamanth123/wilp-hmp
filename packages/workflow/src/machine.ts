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
      | { type: 'ALLOCATION_REJECTED' }
      | { type: 'EDIT_STARTED' }
      | { type: 'SUBMITTED' }
      | { type: 'SME_REVIEW_REQUESTED' }
      | { type: 'SME_APPROVED' }
      | { type: 'SME_REVERTED' }
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
    // Prompt 22: PC reviews the allocation here. ASSIGNED = confirm (→ faculty
    // work begins); ALLOCATION_REJECTED = bounce back to HOG to re-allocate.
    ALLOCATED: { on: { ASSIGNED: 'ASSIGNED', ALLOCATION_REJECTED: 'REQUESTED' } },
    ASSIGNED: { on: { EDIT_STARTED: 'IN_PROGRESS' } },
    // Prompt 12-a: IN_PROGRESS keeps the legacy SUBMITTED→SUBMITTED edge AND
    // gains SME_REVIEW_REQUESTED→SME_REVIEW. The faculty submit action picks
    // which event to fire based on whether an SmeAssignment exists (opt-in
    // in 12-a; SME path becomes the default in 12-b).
    IN_PROGRESS: { on: { SUBMITTED: 'SUBMITTED', SME_REVIEW_REQUESTED: 'SME_REVIEW' } },
    // Prompt 12-a: the SME approval queue. SME_APPROVED transitions to
    // SUBMITTED — i.e. PC's EXISTING review queue (intentional inversion:
    // the SME_APPROVED *event* yields the SUBMITTED *status*). The SME
    // approval IS the handoff to PC review; the whole SUBMITTED→UNDER_REVIEW
    // →APPROVED chain below is unchanged. SME_REVERTED sends the handout
    // back to the faculty's existing REWORK_REQUESTED state.
    SME_REVIEW: { on: { SME_APPROVED: 'SUBMITTED', SME_REVERTED: 'REWORK_REQUESTED' } },
    SUBMITTED: { on: { REVIEW_REWORK: 'REWORK_REQUESTED', REVIEW_APPROVED: 'UNDER_REVIEW' } },
    UNDER_REVIEW: {
      on: {
        FINAL_APPROVED: 'APPROVED',
        FINAL_REJECTED: 'REJECTED',
        REVIEW_REWORK: 'REWORK_REQUESTED',
      },
    },
    // Prompt 12-a: re-submit fires SME_REVIEW_REQUESTED→SME_REVIEW when an
    // SmeAssignment exists (legacy SUBMITTED→SUBMITTED otherwise). SME is
    // "always the gate" — every (re)submission passes through it, INCLUDING
    // after a PC rework, so REWORK_REQUESTED carries both edges for the same
    // reason IN_PROGRESS does.
    REWORK_REQUESTED: { on: { SUBMITTED: 'SUBMITTED', SME_REVIEW_REQUESTED: 'SME_REVIEW' } },
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
  // Prompt 22: PC confirm (ASSIGNED) or reject (ALLOCATION_REJECTED → REQUESTED).
  [HandoutStatus.ALLOCATED]: {
    ASSIGNED: HandoutStatus.ASSIGNED,
    ALLOCATION_REJECTED: HandoutStatus.REQUESTED,
  },
  [HandoutStatus.ASSIGNED]: { EDIT_STARTED: HandoutStatus.IN_PROGRESS },
  // 12-a: legacy SUBMITTED edge preserved; SME_REVIEW_REQUESTED added. The
  // submit action selects the event (SME path is opt-in in 12-a).
  [HandoutStatus.IN_PROGRESS]: {
    SUBMITTED: HandoutStatus.SUBMITTED,
    SME_REVIEW_REQUESTED: HandoutStatus.SME_REVIEW,
  },
  // 12-a: SME_APPROVED → SUBMITTED (PC's existing queue, see machine comment).
  [HandoutStatus.SME_REVIEW]: {
    SME_APPROVED: HandoutStatus.SUBMITTED,
    SME_REVERTED: HandoutStatus.REWORK_REQUESTED,
  },
  [HandoutStatus.SUBMITTED]: {
    REVIEW_REWORK: HandoutStatus.REWORK_REQUESTED,
    REVIEW_APPROVED: HandoutStatus.UNDER_REVIEW,
  },
  [HandoutStatus.UNDER_REVIEW]: {
    FINAL_APPROVED: HandoutStatus.APPROVED,
    FINAL_REJECTED: HandoutStatus.REJECTED,
    REVIEW_REWORK: HandoutStatus.REWORK_REQUESTED,
  },
  // 12-a: re-submit carries both edges (SME is always the gate, incl. after
  // a PC rework).
  [HandoutStatus.REWORK_REQUESTED]: {
    SUBMITTED: HandoutStatus.SUBMITTED,
    SME_REVIEW_REQUESTED: HandoutStatus.SME_REVIEW,
  },
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

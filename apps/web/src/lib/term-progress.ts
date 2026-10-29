import { HandoutStatus } from '@hmp/db';

/**
 * The IC dashboard's "Term timeline", computed from the requests that exist
 * instead of hard-coded ticks. A step is done when at least one request
 * exists and none is still waiting at or before that step. Drafts, rejected
 * and archived requests are left out.
 */

const S = HandoutStatus;

export interface TermStep {
  n: number;
  name: string;
  meta: string;
  /** Requests still waiting at or before this step. */
  waiting: number;
  done: boolean;
}

const STEPS: { name: string; meta: string; waitingAt: HandoutStatus[] }[] = [
  { name: 'Requests raised', meta: 'Instruction Cell raises requests', waitingAt: [] },
  { name: 'Faculty allocated', meta: 'Head of Group allocates faculty', waitingAt: [S.REQUESTED] },
  {
    name: 'Handouts submitted',
    meta: 'Faculty submit their handouts',
    waitingAt: [S.ALLOCATED, S.ASSIGNED, S.IN_PROGRESS, S.REWORK_REQUESTED],
  },
  {
    name: 'Handouts approved',
    meta: 'SME, PC and HOG reviews done',
    waitingAt: [S.SME_REVIEW, S.SUBMITTED, S.UNDER_REVIEW],
  },
  { name: 'Published to Taxila', meta: 'Students can see them', waitingAt: [S.APPROVED] },
];

const COUNTED: HandoutStatus[] = [
  S.REQUESTED,
  S.ALLOCATED,
  S.ASSIGNED,
  S.IN_PROGRESS,
  S.SME_REVIEW,
  S.SUBMITTED,
  S.UNDER_REVIEW,
  S.REWORK_REQUESTED,
  S.APPROVED,
  S.PUBLISHED,
];

export function termProgress(counts: Partial<Record<HandoutStatus, number>>): TermStep[] {
  const total = COUNTED.reduce((sum, s) => sum + (counts[s] ?? 0), 0);
  let waitingSoFar = 0;
  return STEPS.map((step, i) => {
    waitingSoFar += step.waitingAt.reduce((sum, s) => sum + (counts[s] ?? 0), 0);
    return {
      n: i + 1,
      name: step.name,
      meta: step.meta,
      waiting: waitingSoFar,
      done: total > 0 && waitingSoFar === 0,
    };
  });
}

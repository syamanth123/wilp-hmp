import { describe, expect, it } from 'vitest';
import { HandoutStatus } from '@hmp/db';
import { termProgress } from './term-progress';

const done = (c: Parameters<typeof termProgress>[0]) => termProgress(c).map((s) => s.done);

describe('termProgress', () => {
  it('ticks nothing when there are no requests', () => {
    expect(done({})).toEqual([false, false, false, false, false]);
  });

  it('ignores drafts, rejected and archived requests', () => {
    expect(
      done({ [HandoutStatus.DRAFT]: 2, [HandoutStatus.REJECTED]: 1, [HandoutStatus.ARCHIVED]: 4 }),
    ).toEqual([false, false, false, false, false]);
  });

  it('ticks only "raised" while a request waits for allocation', () => {
    expect(done({ [HandoutStatus.REQUESTED]: 1, [HandoutStatus.PUBLISHED]: 3 })).toEqual([
      true,
      false,
      false,
      false,
      false,
    ]);
  });

  it('a handout with the SME holds back "approved" but not "submitted"', () => {
    expect(done({ [HandoutStatus.SME_REVIEW]: 1, [HandoutStatus.APPROVED]: 2 })).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
  });

  it('ticks everything when all requests are published', () => {
    expect(done({ [HandoutStatus.PUBLISHED]: 5 })).toEqual([true, true, true, true, true]);
  });

  it('reports how many requests are still waiting at each step', () => {
    const steps = termProgress({
      [HandoutStatus.REQUESTED]: 1,
      [HandoutStatus.IN_PROGRESS]: 2,
      [HandoutStatus.APPROVED]: 3,
    });
    expect(steps.map((s) => s.waiting)).toEqual([0, 1, 3, 3, 6]);
  });
});

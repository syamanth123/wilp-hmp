import { describe, it, expect } from 'vitest';
import { HandoutStatus } from '@hmp/db';
import { canTransition, nextStatus } from './machine';

describe('handout workflow', () => {
  it('allows the happy path through the full lifecycle', () => {
    const path: Array<[HandoutStatus, string, HandoutStatus]> = [
      [HandoutStatus.DRAFT, 'REQUEST_INITIATED', HandoutStatus.REQUESTED],
      [HandoutStatus.REQUESTED, 'FACULTY_ALLOCATED', HandoutStatus.ALLOCATED],
      [HandoutStatus.ALLOCATED, 'ASSIGNED', HandoutStatus.ASSIGNED],
      [HandoutStatus.ASSIGNED, 'EDIT_STARTED', HandoutStatus.IN_PROGRESS],
      [HandoutStatus.IN_PROGRESS, 'SUBMITTED', HandoutStatus.SUBMITTED],
      [HandoutStatus.SUBMITTED, 'REVIEW_APPROVED', HandoutStatus.UNDER_REVIEW],
      [HandoutStatus.UNDER_REVIEW, 'FINAL_APPROVED', HandoutStatus.APPROVED],
      [HandoutStatus.APPROVED, 'PUBLISHED', HandoutStatus.PUBLISHED],
      [HandoutStatus.PUBLISHED, 'ARCHIVED', HandoutStatus.ARCHIVED],
    ];
    for (const [from, ev, to] of path) {
      expect(nextStatus(from, ev)).toBe(to);
    }
  });

  it('rejects invalid transitions', () => {
    expect(canTransition(HandoutStatus.DRAFT, 'PUBLISHED')).toBe(false);
    expect(canTransition(HandoutStatus.ARCHIVED, 'SUBMITTED')).toBe(false);
    expect(canTransition(HandoutStatus.SUBMITTED, 'REQUEST_INITIATED')).toBe(false);
  });

  it('supports rework loop', () => {
    expect(nextStatus(HandoutStatus.SUBMITTED, 'REVIEW_REWORK')).toBe(HandoutStatus.REWORK_REQUESTED);
    expect(nextStatus(HandoutStatus.REWORK_REQUESTED, 'SUBMITTED')).toBe(HandoutStatus.SUBMITTED);
  });
});

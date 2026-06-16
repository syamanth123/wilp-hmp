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
    expect(nextStatus(HandoutStatus.SUBMITTED, 'REVIEW_REWORK')).toBe(
      HandoutStatus.REWORK_REQUESTED,
    );
    expect(nextStatus(HandoutStatus.REWORK_REQUESTED, 'SUBMITTED')).toBe(HandoutStatus.SUBMITTED);
  });

  // Prompt 12-a: SME approval gate inserted before SUBMITTED (PC's queue).
  describe('SME approval workflow (Prompt 12-a)', () => {
    it('routes faculty submit to SME_REVIEW via SME_REVIEW_REQUESTED', () => {
      expect(nextStatus(HandoutStatus.IN_PROGRESS, 'SME_REVIEW_REQUESTED')).toBe(
        HandoutStatus.SME_REVIEW,
      );
    });

    it('SME approval lands in SUBMITTED (PC queue), NOT UNDER_REVIEW (HOG queue)', () => {
      // The load-bearing correction: SME_APPROVED → SUBMITTED keeps the
      // existing PC→HOG chain (SUBMITTED→UNDER_REVIEW→APPROVED) intact.
      expect(nextStatus(HandoutStatus.SME_REVIEW, 'SME_APPROVED')).toBe(HandoutStatus.SUBMITTED);
      expect(nextStatus(HandoutStatus.SME_REVIEW, 'SME_APPROVED')).not.toBe(
        HandoutStatus.UNDER_REVIEW,
      );
    });

    it('SME revert sends the handout back to the faculty rework state', () => {
      expect(nextStatus(HandoutStatus.SME_REVIEW, 'SME_REVERTED')).toBe(
        HandoutStatus.REWORK_REQUESTED,
      );
    });

    it('re-submit after rework can re-route through SME (SME is always the gate)', () => {
      expect(nextStatus(HandoutStatus.REWORK_REQUESTED, 'SME_REVIEW_REQUESTED')).toBe(
        HandoutStatus.SME_REVIEW,
      );
    });

    it('preserves the legacy SUBMITTED edges (opt-out path when no SME assigned)', () => {
      expect(nextStatus(HandoutStatus.IN_PROGRESS, 'SUBMITTED')).toBe(HandoutStatus.SUBMITTED);
      expect(nextStatus(HandoutStatus.REWORK_REQUESTED, 'SUBMITTED')).toBe(HandoutStatus.SUBMITTED);
    });

    it('keeps the PC→HOG chain unchanged downstream of SUBMITTED', () => {
      expect(nextStatus(HandoutStatus.SUBMITTED, 'REVIEW_APPROVED')).toBe(
        HandoutStatus.UNDER_REVIEW,
      );
      expect(nextStatus(HandoutStatus.UNDER_REVIEW, 'FINAL_APPROVED')).toBe(HandoutStatus.APPROVED);
    });

    it('rejects SME events from non-SME_REVIEW states', () => {
      expect(canTransition(HandoutStatus.SUBMITTED, 'SME_APPROVED')).toBe(false);
      expect(canTransition(HandoutStatus.IN_PROGRESS, 'SME_APPROVED')).toBe(false);
      expect(canTransition(HandoutStatus.SME_REVIEW, 'REVIEW_APPROVED')).toBe(false);
    });
  });

  // Prompt 22: PC allocation review — confirm (existing ASSIGNED) OR reject.
  describe('PC allocation reject (Prompt 22)', () => {
    it('ALLOCATION_REJECTED sends ALLOCATED back to REQUESTED', () => {
      expect(nextStatus(HandoutStatus.ALLOCATED, 'ALLOCATION_REJECTED')).toBe(
        HandoutStatus.REQUESTED,
      );
    });

    it('leaves the existing ASSIGNED confirm edge intact (confirm OR reject)', () => {
      expect(nextStatus(HandoutStatus.ALLOCATED, 'ASSIGNED')).toBe(HandoutStatus.ASSIGNED);
    });

    it('ALLOCATION_REJECTED is only valid from ALLOCATED', () => {
      expect(canTransition(HandoutStatus.REQUESTED, 'ALLOCATION_REJECTED')).toBe(false);
      expect(canTransition(HandoutStatus.ASSIGNED, 'ALLOCATION_REJECTED')).toBe(false);
      expect(canTransition(HandoutStatus.SUBMITTED, 'ALLOCATION_REJECTED')).toBe(false);
    });

    it('a rejected request can be re-allocated (REQUESTED → ALLOCATED again)', () => {
      expect(nextStatus(HandoutStatus.REQUESTED, 'FACULTY_ALLOCATED')).toBe(
        HandoutStatus.ALLOCATED,
      );
    });
  });
});

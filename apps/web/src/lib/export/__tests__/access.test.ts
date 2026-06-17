import { describe, it, expect } from 'vitest';
import { HandoutStatus, RoleName } from '@hmp/db';
import { canExportHandout } from '../access';

/**
 * Exhaustive role × status × ownership truth table for the 1F export gate.
 */

const ALL_STATUSES = Object.values(HandoutStatus) as HandoutStatus[];
const PRIV: RoleName[] = [RoleName.INSTRUCTION_CELL, RoleName.HOG, RoleName.ADMIN];
const PRIV_OK: HandoutStatus[] = [HandoutStatus.APPROVED, HandoutStatus.PUBLISHED];
const FAC_OK: HandoutStatus[] = [
  HandoutStatus.SME_REVIEW,
  HandoutStatus.SUBMITTED,
  HandoutStatus.UNDER_REVIEW,
  HandoutStatus.REWORK_REQUESTED,
  HandoutStatus.APPROVED,
  HandoutStatus.PUBLISHED,
];

describe('canExportHandout — privileged roles (IC/HOG/Admin)', () => {
  for (const role of PRIV) {
    for (const status of ALL_STATUSES) {
      const expected = PRIV_OK.includes(status);
      it(`${role} @ ${status} → ${expected ? 'allow' : 'deny'}`, () => {
        expect(canExportHandout({ roles: [role], status, isOwnerFaculty: false })).toBe(expected);
      });
    }
  }
});

describe('canExportHandout — faculty owner vs non-owner', () => {
  for (const status of ALL_STATUSES) {
    const ownerExpected = FAC_OK.includes(status);
    it(`owner faculty @ ${status} → ${ownerExpected ? 'allow' : 'deny'}`, () => {
      expect(canExportHandout({ roles: [RoleName.FACULTY], status, isOwnerFaculty: true })).toBe(
        ownerExpected,
      );
    });
    it(`non-owner faculty @ ${status} → deny`, () => {
      expect(canExportHandout({ roles: [RoleName.FACULTY], status, isOwnerFaculty: false })).toBe(
        false,
      );
    });
  }
});

describe('canExportHandout — PC & SME never allowed', () => {
  for (const role of [RoleName.PROGRAMME_COMMITTEE, RoleName.SME]) {
    for (const status of ALL_STATUSES) {
      it(`${role} @ ${status} (no faculty assignment) → deny`, () => {
        expect(canExportHandout({ roles: [role], status, isOwnerFaculty: false })).toBe(false);
      });
    }
  }

  it('a PC who is ALSO an owning faculty CAN export (faculty path wins)', () => {
    // Defensive: access is by capability, not exclusion. If a PC happened to be
    // the assigned faculty, the faculty rule grants access at a faculty status.
    expect(
      canExportHandout({
        roles: [RoleName.PROGRAMME_COMMITTEE, RoleName.FACULTY],
        status: HandoutStatus.SME_REVIEW,
        isOwnerFaculty: true,
      }),
    ).toBe(true);
  });
});

describe('canExportHandout — privileged at a faculty-only status', () => {
  it('IC @ SME_REVIEW (no assignment) → deny (privileged set is APPROVED/PUBLISHED only)', () => {
    expect(
      canExportHandout({
        roles: [RoleName.INSTRUCTION_CELL],
        status: HandoutStatus.SME_REVIEW,
        isOwnerFaculty: false,
      }),
    ).toBe(false);
  });
});

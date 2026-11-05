import { describe, it, expect } from 'vitest';
import { HandoutStatus, RoleName } from '@hmp/db';
import { canExportHandout, isDraftDownload } from '../access';

/**
 * Exhaustive role × status × ownership truth table for the download gate
 * (Handout Library decision D1).
 */

const S = HandoutStatus;
const ALL_STATUSES = Object.values(HandoutStatus) as HandoutStatus[];
const ALL_ROLES = Object.values(RoleName) as RoleName[];
const PUBLISHED_TAB: HandoutStatus[] = [S.APPROVED, S.PUBLISHED, S.ARCHIVED];
const IN_PROGRESS = ALL_STATUSES.filter((s) => !PUBLISHED_TAB.includes(s));
const FAC_OK: HandoutStatus[] = [S.SME_REVIEW, S.SUBMITTED, S.UNDER_REVIEW, S.REWORK_REQUESTED];
const REVIEW_OK: HandoutStatus[] = [
  S.ALLOCATED,
  S.ASSIGNED,
  S.IN_PROGRESS,
  S.SME_REVIEW,
  S.SUBMITTED,
  S.UNDER_REVIEW,
  S.REWORK_REQUESTED,
];

describe('anything in the Published tab: every role may download', () => {
  for (const role of ALL_ROLES) {
    for (const status of PUBLISHED_TAB) {
      it(`${role} @ ${status} → allow`, () => {
        expect(canExportHandout({ roles: [role], status, isOwnerFaculty: false })).toBe(true);
      });
    }
  }
});

describe('in progress: IC / HOG / Admin keep today’s rule (no download)', () => {
  for (const role of [RoleName.INSTRUCTION_CELL, RoleName.HOG, RoleName.ADMIN]) {
    for (const status of IN_PROGRESS) {
      it(`${role} @ ${status} → deny`, () => {
        expect(canExportHandout({ roles: [role], status, isOwnerFaculty: false })).toBe(false);
      });
    }
  }
});

describe('in progress: faculty owner vs non-owner', () => {
  for (const status of IN_PROGRESS) {
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

describe('in progress: Programme Committee and the assigned SME (new in D1)', () => {
  for (const status of IN_PROGRESS) {
    const expected = REVIEW_OK.includes(status);
    it(`PC @ ${status} → ${expected ? 'allow' : 'deny'}`, () => {
      expect(
        canExportHandout({ roles: [RoleName.PROGRAMME_COMMITTEE], status, isOwnerFaculty: false }),
      ).toBe(expected);
    });
    it(`assigned SME @ ${status} → ${expected ? 'allow' : 'deny'}`, () => {
      expect(
        canExportHandout({
          roles: [RoleName.SME],
          status,
          isOwnerFaculty: false,
          isAssignedSme: true,
        }),
      ).toBe(expected);
    });
    it(`another SME @ ${status} → deny`, () => {
      expect(canExportHandout({ roles: [RoleName.SME], status, isOwnerFaculty: false })).toBe(
        false,
      );
    });
  }
});

it('draft and rejected requests: nobody', () => {
  for (const status of [S.DRAFT, S.REJECTED]) {
    expect(
      canExportHandout({ roles: ALL_ROLES, status, isOwnerFaculty: true, isAssignedSme: true }),
    ).toBe(false);
  }
});

it('a user with no roles gets nothing', () => {
  expect(canExportHandout({ roles: [], status: S.PUBLISHED, isOwnerFaculty: false })).toBe(false);
});

it('every download outside the Published tab carries the draft mark', () => {
  for (const status of ALL_STATUSES) {
    expect(isDraftDownload(status)).toBe(!PUBLISHED_TAB.includes(status));
  }
});

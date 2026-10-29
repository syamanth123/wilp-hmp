import { describe, expect, it } from 'vitest';
import { RoleName } from '@hmp/db';
import { canOpenSmeReview } from './sme-access';

const SME_A = 'sme-a';
const SME_B = 'sme-b';

describe('canOpenSmeReview', () => {
  it('lets the assigned SME open the handout', () => {
    expect(
      canOpenSmeReview({ roles: [RoleName.SME], userId: SME_A, assignedSmeUserId: SME_A }),
    ).toBe(true);
  });

  it('refuses a different SME', () => {
    expect(
      canOpenSmeReview({ roles: [RoleName.SME], userId: SME_B, assignedSmeUserId: SME_A }),
    ).toBe(false);
  });

  it('refuses an SME when the handout has no SME assigned', () => {
    expect(
      canOpenSmeReview({ roles: [RoleName.SME], userId: SME_A, assignedSmeUserId: null }),
    ).toBe(false);
    expect(
      canOpenSmeReview({ roles: [RoleName.SME], userId: SME_A, assignedSmeUserId: undefined }),
    ).toBe(false);
  });

  it('leaves admin unchanged: any handout, assigned or not', () => {
    expect(
      canOpenSmeReview({ roles: [RoleName.ADMIN], userId: 'admin', assignedSmeUserId: SME_A }),
    ).toBe(true);
    expect(
      canOpenSmeReview({ roles: [RoleName.ADMIN], userId: 'admin', assignedSmeUserId: null }),
    ).toBe(true);
  });

  it('refuses users without the SME or admin role', () => {
    for (const role of [
      RoleName.FACULTY,
      RoleName.HOG,
      RoleName.PROGRAMME_COMMITTEE,
      RoleName.INSTRUCTION_CELL,
    ]) {
      expect(canOpenSmeReview({ roles: [role], userId: SME_A, assignedSmeUserId: SME_A })).toBe(
        false,
      );
    }
  });
});

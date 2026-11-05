import { describe, expect, it } from 'vitest';
import { RoleName, type HandoutStatus } from '@hmp/db';
import {
  IN_PROGRESS_STATUSES,
  OVERSIGHT_ONLY_STATUSES,
  PUBLISHED_STATUSES,
  libraryScope,
  seesAllWork,
} from '../handout-access';

// The library's one access rule, role by role (docs/plans/handout-library.md §1). The e2e spec
// proves the same against the database (lists, URLs, downloads, suggestions).

const user = (...roles: RoleName[]) => ({ id: 'u1', roles });
const statusesOf = (w: object) =>
  ((w as { status?: { in?: HandoutStatus[] } }).status?.in ?? []).slice().sort();
const sorted = (xs: HandoutStatus[]) => xs.slice().sort();

describe('libraryScope', () => {
  it('Published tab: the same for every role (approved, published, archived)', () => {
    for (const r of Object.values(RoleName)) {
      expect(libraryScope(user(r), 'published')).toEqual({ status: { in: PUBLISHED_STATUSES } });
    }
  });

  it('In progress: oversight roles see all of it, drafts and rejected included (filter-only)', () => {
    for (const r of [
      RoleName.ADMIN,
      RoleName.INSTRUCTION_CELL,
      RoleName.HOG,
      RoleName.PROGRAMME_COMMITTEE,
    ]) {
      const w = libraryScope(user(r), 'in-progress');
      expect(statusesOf(w)).toEqual(sorted([...IN_PROGRESS_STATUSES, ...OVERSIGHT_ONLY_STATUSES]));
      expect(w).not.toHaveProperty('OR');
    }
  });

  it('In progress: faculty only their ACTIVE assignments, never drafts or rejected', () => {
    const w = libraryScope(user(RoleName.FACULTY), 'in-progress');
    expect(statusesOf(w)).toEqual(sorted(IN_PROGRESS_STATUSES));
    expect(w).toMatchObject({
      OR: [{ assignments: { some: { facultyId: 'u1', active: true } } }],
    });
  });

  it('In progress: SMEs only the handouts assigned to them', () => {
    expect(libraryScope(user(RoleName.SME), 'in-progress')).toMatchObject({
      OR: [{ smeAssignment: { is: { smeUserId: 'u1' } } }],
    });
  });

  it('a faculty member who is also an SME: either rule', () => {
    const w = libraryScope(user(RoleName.FACULTY, RoleName.SME), 'in-progress') as {
      OR: unknown[];
    };
    expect(w.OR).toHaveLength(2);
  });

  it('no role → nothing at all', () => {
    expect(libraryScope(user(), 'in-progress')).toEqual({ id: { in: [] } });
  });

  it('seesAllWork = the oversight roles', () => {
    expect(seesAllWork(user(RoleName.HOG))).toBe(true);
    expect(seesAllWork(user(RoleName.FACULTY, RoleName.SME))).toBe(false);
  });
});

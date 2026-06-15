import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ACTIVE_USER_FILTER, requireActiveUser } from '../user-helpers';

/**
 * Tests for the Prompt 18 soft-delete helpers. ACTIVE_USER_FILTER is a pure
 * constant (tested without a DB). requireActiveUser hits a real Prisma client,
 * so those cases probe-skip when Postgres is unreachable — same convention as
 * corpus-import-action.test.ts.
 */

describe('ACTIVE_USER_FILTER', () => {
  it('is exactly { active: true } (soft-delete is via active, no deletedAt)', () => {
    expect(ACTIVE_USER_FILTER).toEqual({ active: true });
  });
});

const prisma = new PrismaClient();
let dbReady = false;
const PREFIX = `UH-TEST-${process.pid}-${Date.now()}`;
const createdUserIds: string[] = [];

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReady = true;
  } catch {
    dbReady = false;
  }
  if (!dbReady) console.warn('[user-helpers.test] Postgres unreachable — probe-skipping.');
});

afterAll(async () => {
  if (createdUserIds.length) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await prisma.$disconnect();
});

async function makeUser(active: boolean): Promise<string> {
  const u = await prisma.user.create({
    data: {
      email: `${PREFIX}-${active ? 'a' : 'i'}-${createdUserIds.length}@test.local`,
      name: 'UH',
      active,
    },
    select: { id: true },
  });
  createdUserIds.push(u.id);
  return u.id;
}

describe('requireActiveUser', () => {
  it('returns an active user', async () => {
    if (!dbReady) return;
    const id = await makeUser(true);
    const user = await requireActiveUser(id);
    expect(user.id).toBe(id);
    expect(user.active).toBe(true);
  });

  it('throws for a deactivated user', async () => {
    if (!dbReady) return;
    const id = await makeUser(false);
    await expect(requireActiveUser(id)).rejects.toThrow(/user_not_found_or_inactive/);
  });

  it('throws for a missing user', async () => {
    if (!dbReady) return;
    await expect(requireActiveUser('nonexistent-id')).rejects.toThrow(/user_not_found_or_inactive/);
  });
});

import { describe, it, expect, afterEach } from 'vitest';
import { resolveProductionAdmin, shouldCreateAdmin } from './seed.production';
import { assertDevOnly } from './seed-scaffolding';

const ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ENV };
});

describe('production seed — credential guard', () => {
  it('throws when ADMIN_EMAIL / ADMIN_INITIAL_PASSWORD_HASH are unset (no default admin)', () => {
    delete process.env.ADMIN_EMAIL;
    delete process.env.ADMIN_INITIAL_PASSWORD_HASH;
    expect(() => resolveProductionAdmin()).toThrow(/must both be set/i);
  });

  it('throws when only one of the two is set', () => {
    process.env.ADMIN_EMAIL = 'admin@example.edu';
    delete process.env.ADMIN_INITIAL_PASSWORD_HASH;
    expect(() => resolveProductionAdmin()).toThrow(/must both be set/i);
  });

  it('returns the credentials when both are set', () => {
    process.env.ADMIN_EMAIL = 'admin@example.edu';
    process.env.ADMIN_INITIAL_PASSWORD_HASH = '$2b$12$abcdefghijklmnopqrstuv';
    expect(resolveProductionAdmin()).toEqual({
      email: 'admin@example.edu',
      passwordHash: '$2b$12$abcdefghijklmnopqrstuv',
    });
  });
});

describe('production seed — idempotency guard', () => {
  it('does NOT create the admin when a user already exists (second run no-ops)', async () => {
    const client = { user: { count: async () => 1 } };
    expect(await shouldCreateAdmin(client as never)).toBe(false);
  });

  it('creates the admin only on an empty user table', async () => {
    const client = { user: { count: async () => 0 } };
    expect(await shouldCreateAdmin(client as never)).toBe(true);
  });
});

describe('dev seed — production guard', () => {
  it('assertDevOnly throws when NODE_ENV=production', () => {
    process.env.NODE_ENV = 'production';
    expect(() => assertDevOnly()).toThrow(/dev-only/i);
  });

  it('assertDevOnly is a no-op outside production', () => {
    process.env.NODE_ENV = 'development';
    expect(() => assertDevOnly()).not.toThrow();
  });
});

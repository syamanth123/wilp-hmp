import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { redisMock, auditMock } = vi.hoisted(() => ({
  redisMock: {
    incr: vi.fn(),
    expire: vi.fn(),
    ttl: vi.fn(),
    del: vi.fn(),
    get: vi.fn(),
    on: vi.fn(),
  },
  auditMock: vi.fn(),
}));

vi.mock('ioredis', () => ({ Redis: vi.fn(() => redisMock) }));
vi.mock('@/lib/audit', () => ({ audit: auditMock }));

import {
  rateLimit,
  peekRateLimit,
  tooManyRequests,
  loginRateLimit,
  loginIpRateLimit,
  recordLoginFailure,
  clearLoginUsername,
  RATE_LIMITS,
} from './rate-limit';

beforeEach(() => {
  process.env.REDIS_URL = 'redis://localhost:6379';
  redisMock.incr.mockReset();
  redisMock.expire.mockReset().mockResolvedValue(1);
  redisMock.ttl.mockReset().mockResolvedValue(120);
  redisMock.del.mockReset().mockResolvedValue(1);
  redisMock.get.mockReset().mockResolvedValue(null);
  auditMock.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('rateLimit', () => {
  it('allows under the limit and sets EXPIRE only on the first hit', async () => {
    redisMock.incr.mockResolvedValue(1);
    const r = await rateLimit('login:1.2.3.4', 5, 900);
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(4);
    expect(redisMock.expire).toHaveBeenCalledWith('rl:login:1.2.3.4', 900);
  });

  it('does NOT re-set EXPIRE on subsequent hits in the window', async () => {
    redisMock.incr.mockResolvedValue(3);
    await rateLimit('login:1.2.3.4', 5, 900);
    expect(redisMock.expire).not.toHaveBeenCalled();
  });

  it('allows exactly at the limit (count === limit)', async () => {
    redisMock.incr.mockResolvedValue(5);
    const r = await rateLimit('login:1.2.3.4', 5, 900);
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(0);
  });

  it('blocks over the limit with a Retry-After derived from TTL', async () => {
    redisMock.incr.mockResolvedValue(6);
    redisMock.ttl.mockResolvedValue(842);
    const r = await rateLimit('login:1.2.3.4', 5, 900);
    expect(r.ok).toBe(false);
    expect(r.retryAfterSec).toBe(842);
    expect(redisMock.expire).not.toHaveBeenCalled();
  });

  it('gives a blocked key that lost its TTL (EXPIRE failed after INCR) a window, so the block is bounded', async () => {
    redisMock.incr.mockResolvedValue(6);
    redisMock.ttl.mockResolvedValue(-1);
    const r = await rateLimit('login:1.2.3.4', 5, 900);
    expect(r.ok).toBe(false);
    expect(r.retryAfterSec).toBe(900);
    expect(redisMock.expire).toHaveBeenCalledWith('rl:login:1.2.3.4', 900);
  });

  it('fails OPEN on a Redis error + records a ratelimit.unavailable audit row', async () => {
    redisMock.incr.mockRejectedValue(new Error('ECONNREFUSED'));
    const r = await rateLimit('login:1.2.3.4', 5, 900);
    expect(r.ok).toBe(true);
    expect(r.degraded).toBe(true);
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(auditMock.mock.calls[0]![0]).toMatchObject({ action: 'ratelimit.unavailable' });
  });

  it('still fails open when BOTH Redis AND the audit write fail (inner boundary)', async () => {
    redisMock.incr.mockRejectedValue(new Error('redis down'));
    auditMock.mockRejectedValue(new Error('db down too'));
    const r = await rateLimit('login:1.2.3.4', 5, 900);
    expect(r.ok).toBe(true);
    expect(r.degraded).toBe(true); // audit failure swallowed; request still allowed
  });

  it('fails open (no Redis call) when REDIS_URL is unset', async () => {
    delete process.env.REDIS_URL;
    const r = await rateLimit('login:1.2.3.4', 5, 900);
    expect(r.ok).toBe(true);
    expect(r.degraded).toBe(true);
    expect(redisMock.incr).not.toHaveBeenCalled();
  });
});

describe('peekRateLimit — read-only check of a counter advanced elsewhere', () => {
  it('allows with the full budget when the key does not exist, and never INCRs', async () => {
    redisMock.get.mockResolvedValue(null);
    const r = await peekRateLimit('login:ip:1.2.3.4', 30, 900);
    expect(r).toEqual({ ok: true, remaining: 30, retryAfterSec: 0 });
    expect(redisMock.incr).not.toHaveBeenCalled();
    expect(redisMock.expire).not.toHaveBeenCalled();
  });

  it('allows while the count is below the limit', async () => {
    redisMock.get.mockResolvedValue('29');
    const r = await peekRateLimit('login:ip:1.2.3.4', 30, 900);
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(1);
  });

  it('blocks once the count has REACHED the limit (limit hits tolerated, the next is not)', async () => {
    redisMock.get.mockResolvedValue('30');
    redisMock.ttl.mockResolvedValue(777);
    const r = await peekRateLimit('login:ip:1.2.3.4', 30, 900);
    expect(r.ok).toBe(false);
    expect(r.retryAfterSec).toBe(777);
  });

  it('treats an unreadable value as zero (fail open) and a vanished key as the full window', async () => {
    redisMock.get.mockResolvedValue('not-a-number');
    expect((await peekRateLimit('login:ip:x', 30, 900)).ok).toBe(true);
    redisMock.get.mockResolvedValue('31');
    redisMock.ttl.mockResolvedValue(-2);
    expect((await peekRateLimit('login:ip:x', 30, 900)).retryAfterSec).toBe(900);
    expect(redisMock.expire).not.toHaveBeenCalled();
  });

  it('gives a blocked key that has no TTL a window instead of blocking forever', async () => {
    redisMock.get.mockResolvedValue('30');
    redisMock.ttl.mockResolvedValue(-1);
    const r = await peekRateLimit('login:ip:1.2.3.4', 30, 900);
    expect(r.ok).toBe(false);
    expect(r.retryAfterSec).toBe(900);
    expect(redisMock.expire).toHaveBeenCalledWith('rl:login:ip:1.2.3.4', 900);
  });

  it('fails OPEN on a Redis error with the same audit row as rateLimit()', async () => {
    redisMock.get.mockRejectedValue(new Error('ECONNREFUSED'));
    const r = await peekRateLimit('login:ip:1.2.3.4', 30, 900);
    expect(r.ok).toBe(true);
    expect(r.degraded).toBe(true);
    expect(auditMock.mock.calls[0]![0]).toMatchObject({
      action: 'ratelimit.unavailable',
      entityId: 'login:ip:1.2.3.4',
    });
  });

  it('fails open (no Redis call) when REDIS_URL is unset', async () => {
    delete process.env.REDIS_URL;
    const r = await peekRateLimit('login:ip:1.2.3.4', 30, 900);
    expect(r.degraded).toBe(true);
    expect(redisMock.get).not.toHaveBeenCalled();
  });
});

/** In-memory stand-in for the two Redis commands the login counters use. */
function useCountingRedis(): Map<string, number> {
  const store = new Map<string, number>();
  redisMock.incr.mockImplementation((k: string) => {
    const v = (store.get(k) ?? 0) + 1;
    store.set(k, v);
    return Promise.resolve(v);
  });
  redisMock.get.mockImplementation((k: string) =>
    Promise.resolve(store.has(k) ? String(store.get(k)) : null),
  );
  return store;
}

describe('loginRateLimit — per-IP counts REJECTED attempts only; per-username counts every attempt', () => {
  it('31 successful logins from one IP stay allowed: the per-IP counter is read, never advanced', async () => {
    const store = useCountingRedis();
    for (let i = 0; i < 31; i++) {
      const r = await loginRateLimit('1.2.3.4', `user${i}@bits.ac.in`);
      expect(r.ok).toBe(true);
      await clearLoginUsername(`user${i}@bits.ac.in`); // what signInAction does on success
    }
    expect(store.has('rl:login:ip:1.2.3.4')).toBe(false);
    expect(redisMock.incr).not.toHaveBeenCalledWith('rl:login:ip:1.2.3.4');
  });

  it('31 failures from one IP get blocked: 30 recorded failures, then the 31st attempt is refused', async () => {
    const store = useCountingRedis();
    for (let i = 0; i < RATE_LIMITS.loginIp.limit; i++) {
      const r = await loginRateLimit('1.2.3.4', `user${i}@bits.ac.in`);
      expect(r.ok).toBe(true);
      await recordLoginFailure('1.2.3.4');
    }
    expect(store.get('rl:login:ip:1.2.3.4')).toBe(30);
    const r31 = await loginRateLimit('1.2.3.4', 'user31@bits.ac.in');
    expect(r31.ok).toBe(false);
    expect(r31.retryAfterSec).toBe(120);
  });

  it('recordLoginFailure sets EXPIRE on the first failure of a window only (fixed window)', async () => {
    useCountingRedis();
    await recordLoginFailure('1.2.3.4');
    await recordLoginFailure('1.2.3.4');
    expect(redisMock.expire).toHaveBeenCalledTimes(1);
    expect(redisMock.expire).toHaveBeenCalledWith(
      'rl:login:ip:1.2.3.4',
      RATE_LIMITS.loginIp.windowSec,
    );
  });

  it('a blocked attempt does not advance the per-IP counter', async () => {
    const store = useCountingRedis();
    store.set('rl:login:ip:1.2.3.4', 30);
    const r = await loginRateLimit('1.2.3.4', 'a@bits.ac.in');
    expect(r.ok).toBe(false);
    expect(store.get('rl:login:ip:1.2.3.4')).toBe(30);
  });

  it('per-username limit fires at the 6th attempt regardless of IP variety (unchanged)', async () => {
    // username counter over 5, ip counter empty (attacker rotating IPs)
    redisMock.incr.mockImplementation((k: string) => Promise.resolve(k.includes(':user:') ? 6 : 1));
    const r = await loginRateLimit('9.9.9.9', 'target@bits.ac.in');
    expect(r.ok).toBe(false);
  });

  it('per-username counter is advanced on EVERY attempt, successful ones included', async () => {
    const store = useCountingRedis();
    await loginRateLimit('1.2.3.4', 'a@bits.ac.in');
    expect(store.get('rl:login:user:a@bits.ac.in')).toBe(1);
  });

  it('allows when both counters are under their limits', async () => {
    useCountingRedis();
    const r = await loginRateLimit('1.2.3.4', 'a@bits.ac.in');
    expect(r.ok).toBe(true);
  });

  it('loginIpRateLimit (no username) is the same read-only per-IP check', async () => {
    const store = useCountingRedis();
    expect((await loginIpRateLimit('1.2.3.4')).ok).toBe(true);
    store.set('rl:login:ip:1.2.3.4', 30);
    expect((await loginIpRateLimit('1.2.3.4')).ok).toBe(false);
    expect(redisMock.incr).not.toHaveBeenCalled();
  });

  it('clearLoginUsername resets ONLY the per-username key (lowercased/trimmed), not per-IP', async () => {
    await clearLoginUsername('  Foo@Bits.AC.in ');
    expect(redisMock.del).toHaveBeenCalledWith('rl:login:user:foo@bits.ac.in');
    expect(redisMock.del).not.toHaveBeenCalledWith(expect.stringContaining(':ip:'));
    expect(redisMock.del).toHaveBeenCalledTimes(1);
  });
});

describe('tooManyRequests', () => {
  it('returns a 429 with a Retry-After header (>=1)', async () => {
    const res = tooManyRequests(842);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('842');
  });

  it('clamps Retry-After to a minimum of 1', async () => {
    const res = tooManyRequests(0);
    expect(res.headers.get('Retry-After')).toBe('1');
  });
});

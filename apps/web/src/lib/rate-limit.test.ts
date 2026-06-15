import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { redisMock, auditMock } = vi.hoisted(() => ({
  redisMock: { incr: vi.fn(), expire: vi.fn(), ttl: vi.fn(), on: vi.fn() },
  auditMock: vi.fn(),
}));

vi.mock('ioredis', () => ({ Redis: vi.fn(() => redisMock) }));
vi.mock('@/lib/audit', () => ({ audit: auditMock }));

import { rateLimit, tooManyRequests } from './rate-limit';

beforeEach(() => {
  process.env.REDIS_URL = 'redis://localhost:6379';
  redisMock.incr.mockReset();
  redisMock.expire.mockReset().mockResolvedValue(1);
  redisMock.ttl.mockReset().mockResolvedValue(120);
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

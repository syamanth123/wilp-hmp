import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CredentialsSignin } from 'next-auth';

// signInAction against the REAL limiter (rate-limit.ts) with an in-memory
// Redis, so these are the end-to-end numbers the throttle promises: 31
// successful logins from one address are all allowed; 30 rejected attempts
// from one address block the 31st; a visitor-supplied X-Forwarded-For cannot
// move the key away from the nginx-set X-Real-IP; and only a freshly issued
// session cookie counts as a login.
const { headersMock, signInMock, findManyMock, store, redisFake, cookieJar } = vi.hoisted(() => {
  const store = new Map<string, number>();
  const redisFake = {
    on: vi.fn(),
    incr: vi.fn((k: string) => {
      const v = (store.get(k) ?? 0) + 1;
      store.set(k, v);
      return Promise.resolve(v);
    }),
    expire: vi.fn(() => Promise.resolve(1)),
    ttl: vi.fn(() => Promise.resolve(600)),
    del: vi.fn((k: string) => {
      store.delete(k);
      return Promise.resolve(1);
    }),
    get: vi.fn((k: string) => Promise.resolve(store.has(k) ? String(store.get(k)) : null)),
  };
  // Stand-in for next/headers cookies(): the request's cookies, which
  // next-auth's signIn() writes the issued session cookie into.
  const jar = new Map<string, string>();
  const cookieJar = {
    jar,
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => {
      jar.set(name, value);
    },
  };
  return {
    headersMock: vi.fn(),
    signInMock: vi.fn(),
    findManyMock: vi.fn(),
    store,
    redisFake,
    cookieJar,
  };
});

vi.mock('next/headers', () => ({ headers: headersMock, cookies: () => cookieJar }));
vi.mock('@hmp/auth', () => ({ signIn: signInMock }));
vi.mock('@hmp/db', () => ({ prisma: { userRole: { findMany: findManyMock } } }));
vi.mock('@/lib/routing', () => ({ defaultRouteForUser: () => '/faculty' }));
vi.mock('ioredis', () => ({ Redis: vi.fn(() => redisFake) }));
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }));

import { signInAction } from '../actions';

const REAL_IP = '10.0.0.7';
const SPOOFED = '1.2.3.4';
const TOO_MANY = 'Too many login attempts. Please wait a few minutes and try again.';
const INVALID = 'Invalid email or password.';

let issued = 0;
/** What next-auth's signIn() does on acceptance: writes a fresh session cookie. */
const acceptAndIssueCookie = () => {
  cookieJar.set('authjs.session-token', `jwt-${++issued}`);
  return Promise.resolve('http://localhost:3000/');
};
/** The X-Auth-Return-Redirect quirk: Auth.js resolves with the error URL, no cookie. */
const rejectWithoutThrowing = () =>
  Promise.resolve('http://localhost:3000/login?error=CredentialsSignin&code=credentials');

beforeEach(() => {
  process.env.REDIS_URL = 'redis://localhost:6379';
  store.clear();
  cookieJar.jar.clear();
  signInMock.mockReset();
  findManyMock.mockReset().mockResolvedValue([{ role: { name: 'FACULTY' } }]);
  headersMock
    .mockReset()
    .mockReturnValue(new Headers({ 'x-real-ip': REAL_IP, 'x-forwarded-for': SPOOFED }));
});

describe('signInAction — login throttle', () => {
  it('31 successful logins from one IP stay allowed (the per-IP counter is never spent)', async () => {
    signInMock.mockImplementation(acceptAndIssueCookie);
    for (let i = 0; i < 31; i++) {
      const r = await signInAction({ email: `user${i}@hmp.local`, password: 'pw' });
      expect(r).toEqual({ redirectTo: '/faculty' });
    }
    expect(signInMock).toHaveBeenCalledTimes(31);
    expect([...store.keys()].filter((k) => k.startsWith('rl:login:ip:'))).toEqual([]);
  });

  it('31 failures from one IP get blocked: 30 rejected attempts, then the 31st is refused before NextAuth', async () => {
    signInMock.mockRejectedValue(new CredentialsSignin());
    for (let i = 0; i < 30; i++) {
      const r = await signInAction({ email: `user${i}@hmp.local`, password: 'wrong' });
      expect(r).toEqual({ error: INVALID });
    }
    expect(store.get(`rl:login:ip:${REAL_IP}`)).toBe(30);
    const r31 = await signInAction({ email: 'user30@hmp.local', password: 'wrong' });
    expect(r31).toEqual({ error: TOO_MANY });
    expect(signInMock).toHaveBeenCalledTimes(30);
  });

  it('a spoofed X-Forwarded-For does not change the key: failures land on the X-Real-IP address', async () => {
    // XFF carries ONLY the spoofed hop, so a last-hop fallback would key on it.
    signInMock.mockRejectedValue(new CredentialsSignin());
    await signInAction({ email: 'a@hmp.local', password: 'wrong' });
    expect(store.get(`rl:login:ip:${REAL_IP}`)).toBe(1);
    expect(store.has(`rl:login:ip:${SPOOFED}`)).toBe(false);
  });

  it('with neither proxy header present the key is "unknown"', async () => {
    // (A bare `next start` fills X-Forwarded-For with the socket peer itself;
    // this is the no-headers-at-all shape.)
    headersMock.mockReturnValue(new Headers());
    signInMock.mockRejectedValue(new CredentialsSignin());
    await signInAction({ email: 'a@hmp.local', password: 'wrong' });
    expect(store.get('rl:login:ip:unknown')).toBe(1);
  });

  it('per-username limit is unchanged: the 6th attempt for one account is refused from a clean IP', async () => {
    signInMock.mockRejectedValue(new CredentialsSignin());
    for (let i = 0; i < 5; i++) {
      const r = await signInAction({ email: 'target@hmp.local', password: 'wrong' });
      expect(r).toEqual({ error: INVALID });
    }
    const r6 = await signInAction({ email: 'target@hmp.local', password: 'wrong' });
    expect(r6).toEqual({ error: TOO_MANY });
    expect(store.get(`rl:login:ip:${REAL_IP}`)).toBe(5); // far under 30: the username limit fired
    expect(signInMock).toHaveBeenCalledTimes(5);
  });

  it('a successful login clears the per-username counter and leaves the per-IP failures in place', async () => {
    signInMock
      .mockRejectedValueOnce(new CredentialsSignin())
      .mockImplementation(acceptAndIssueCookie);
    await signInAction({ email: 'a@hmp.local', password: 'wrong' });
    expect(store.get('rl:login:user:a@hmp.local')).toBe(1);
    const ok = await signInAction({ email: 'a@hmp.local', password: 'right' });
    expect(ok).toEqual({ redirectTo: '/faculty' });
    expect(store.has('rl:login:user:a@hmp.local')).toBe(false);
    expect(store.get(`rl:login:ip:${REAL_IP}`)).toBe(1);
  });

  it('a blocked attempt is not counted as a failure', async () => {
    store.set(`rl:login:ip:${REAL_IP}`, 30);
    const r = await signInAction({ email: 'a@hmp.local', password: 'wrong' });
    expect(r).toEqual({ error: TOO_MANY });
    expect(signInMock).not.toHaveBeenCalled();
    expect(store.get(`rl:login:ip:${REAL_IP}`)).toBe(30);
  });

  it('an infrastructure error inside signIn() is reported as invalid but NOT counted against the IP', async () => {
    signInMock.mockRejectedValue(new Error('CallbackRouteError: database unreachable'));
    const r = await signInAction({ email: 'a@hmp.local', password: 'pw' });
    expect(r).toEqual({ error: INVALID });
    expect(store.has(`rl:login:ip:${REAL_IP}`)).toBe(false);
  });
});

describe('signInAction — acceptance requires a freshly issued session cookie', () => {
  it('signIn() resolving WITHOUT issuing a cookie (X-Auth-Return-Redirect quirk) is a rejected attempt', async () => {
    signInMock.mockImplementation(rejectWithoutThrowing);
    const r = await signInAction({ email: 'target@hmp.local', password: 'anything' });
    expect(r).toEqual({ error: INVALID });
    expect(store.get(`rl:login:ip:${REAL_IP}`)).toBe(1); // counted like any rejection
    expect(store.get('rl:login:user:target@hmp.local')).toBe(1); // NOT cleared
    expect(findManyMock).not.toHaveBeenCalled(); // no role disclosure
  });

  it('a stale session cookie already on the request does not pass for a new login', async () => {
    cookieJar.set('authjs.session-token', 'old-jwt-from-another-account');
    signInMock.mockImplementation(rejectWithoutThrowing);
    const r = await signInAction({ email: 'target@hmp.local', password: 'anything' });
    expect(r).toEqual({ error: INVALID });
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it('a real acceptance replaces the stale cookie and is recognised', async () => {
    cookieJar.set('__Secure-authjs.session-token', 'old-jwt');
    signInMock.mockImplementation(() => {
      cookieJar.set('__Secure-authjs.session-token', 'new-jwt');
      return Promise.resolve('http://localhost:3000/');
    });
    const r = await signInAction({ email: 'a@hmp.local', password: 'right' });
    expect(r).toEqual({ redirectTo: '/faculty' });
  });

  it('chunked session cookies count as issued', async () => {
    signInMock.mockImplementation(() => {
      cookieJar.set('authjs.session-token.0', 'part-0');
      cookieJar.set('authjs.session-token.1', 'part-1');
      return Promise.resolve('http://localhost:3000/');
    });
    const r = await signInAction({ email: 'a@hmp.local', password: 'right' });
    expect(r).toEqual({ redirectTo: '/faculty' });
  });
});

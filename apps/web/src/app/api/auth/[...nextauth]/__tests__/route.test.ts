import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { authPostMock, rl } = vi.hoisted(() => ({
  authPostMock: vi.fn(),
  rl: {
    loginRateLimit: vi.fn(),
    loginIpRateLimit: vi.fn(),
    recordLoginFailure: vi.fn(),
    tooManyRequests: vi.fn(
      (retryAfterSec: number) =>
        new Response('rate_limited', {
          status: 429,
          headers: { 'Retry-After': String(retryAfterSec) },
        }),
    ),
  },
}));

vi.mock('@hmp/auth', () => ({ handlers: { GET: vi.fn(), POST: authPostMock } }));
vi.mock('@/lib/rate-limit', () => rl);

import { POST } from '../route';

const CALLBACK = 'http://localhost:3000/api/auth/callback/credentials';
const REAL_IP = '10.0.0.7';
const SPOOFED = '1.2.3.4';

function credentialsPost(
  headers: Record<string, string>,
  body: BodyInit = new URLSearchParams({ email: 'faculty@hmp.local', password: 'x' }),
  url = CALLBACK,
): NextRequest {
  return new NextRequest(url, { method: 'POST', headers, body });
}

/** What Auth.js answers when authorize() said no: a redirect, no session cookie. */
function rejectedResponse(): Response {
  return new Response(null, {
    status: 302,
    headers: {
      location: 'http://localhost:3000/login?error=CredentialsSignin&code=credentials',
      'set-cookie': 'authjs.callback-url=http%3A%2F%2Flocalhost%3A3000%2F; Path=/; HttpOnly',
    },
  });
}

/** What Auth.js answers on success: a redirect carrying the session cookie. */
function acceptedResponse(cookieName = 'authjs.session-token'): Response {
  const headers = new Headers({ location: 'http://localhost:3000/faculty' });
  headers.append('set-cookie', 'authjs.callback-url=http%3A%2F%2Flocalhost%3A3000%2F; Path=/');
  headers.append(
    'set-cookie',
    `${cookieName}=eyJhbGciOi.payload.sig; Path=/; HttpOnly; SameSite=Lax`,
  );
  return new Response(null, { status: 302, headers });
}

beforeEach(() => {
  authPostMock.mockReset();
  rl.loginRateLimit.mockReset().mockResolvedValue({ ok: true, retryAfterSec: 0 });
  rl.loginIpRateLimit.mockReset().mockResolvedValue({ ok: true, remaining: 30, retryAfterSec: 0 });
  rl.recordLoginFailure.mockReset().mockResolvedValue(undefined);
  rl.tooManyRequests.mockClear();
});

describe('POST /api/auth/callback/credentials — defense-in-depth login throttle', () => {
  it('keys on X-Real-IP and ignores a spoofed X-Forwarded-For', async () => {
    // XFF carries ONLY the spoofed hop, so a last-hop fallback would key on it.
    authPostMock.mockResolvedValue(rejectedResponse());
    const res = await POST(credentialsPost({ 'x-real-ip': REAL_IP, 'x-forwarded-for': SPOOFED }));
    expect(res.status).toBe(302);
    expect(rl.loginRateLimit).toHaveBeenCalledWith(REAL_IP, 'faculty@hmp.local');
    expect(rl.recordLoginFailure).toHaveBeenCalledWith(REAL_IP);
    expect(rl.recordLoginFailure).not.toHaveBeenCalledWith(SPOOFED);
  });

  it('without X-Real-IP keys on the LAST X-Forwarded-For hop, never the first', async () => {
    authPostMock.mockResolvedValue(rejectedResponse());
    await POST(credentialsPost({ 'x-forwarded-for': `${SPOOFED}, ${REAL_IP}` }));
    expect(rl.loginRateLimit).toHaveBeenCalledWith(REAL_IP, 'faculty@hmp.local');
    expect(rl.recordLoginFailure).toHaveBeenCalledWith(REAL_IP);
  });

  it('records a per-IP failure only when NextAuth issued no session cookie', async () => {
    authPostMock.mockResolvedValue(acceptedResponse());
    const res = await POST(credentialsPost({ 'x-real-ip': REAL_IP }));
    expect(res.status).toBe(302);
    expect(rl.recordLoginFailure).not.toHaveBeenCalled();
  });

  it('recognises the __Secure- prefixed and chunked session cookie names as success', async () => {
    authPostMock.mockResolvedValue(acceptedResponse('__Secure-authjs.session-token'));
    await POST(credentialsPost({ 'x-real-ip': REAL_IP }));
    authPostMock.mockResolvedValue(acceptedResponse('authjs.session-token.0'));
    await POST(credentialsPost({ 'x-real-ip': REAL_IP }));
    expect(rl.recordLoginFailure).not.toHaveBeenCalled();
  });

  it('an expiring session cookie (sign-out shape) does not count as success', async () => {
    const headers = new Headers({
      location: 'http://localhost:3000/login?error=CredentialsSignin',
    });
    headers.append('set-cookie', 'authjs.session-token=; Path=/; Max-Age=0');
    authPostMock.mockResolvedValue(new Response(null, { status: 302, headers }));
    await POST(credentialsPost({ 'x-real-ip': REAL_IP }));
    expect(rl.recordLoginFailure).toHaveBeenCalledWith(REAL_IP);
  });

  it('refuses with 429 before NextAuth runs when a limit has tripped, recording nothing', async () => {
    rl.loginRateLimit.mockResolvedValue({ ok: false, retryAfterSec: 540 });
    const res = await POST(credentialsPost({ 'x-real-ip': REAL_IP }));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('540');
    expect(authPostMock).not.toHaveBeenCalled();
    expect(rl.recordLoginFailure).not.toHaveBeenCalled();
  });

  it('applies the per-username limit to a JSON body too (Auth.js parses JSON credentials)', async () => {
    authPostMock.mockResolvedValue(rejectedResponse());
    await POST(
      credentialsPost(
        { 'x-real-ip': REAL_IP, 'content-type': 'application/json' },
        JSON.stringify({ email: 'target@hmp.local', password: 'guess', csrfToken: 't' }),
      ),
    );
    expect(rl.loginRateLimit).toHaveBeenCalledWith(REAL_IP, 'target@hmp.local');
    expect(rl.loginIpRateLimit).not.toHaveBeenCalled();
    expect(rl.recordLoginFailure).toHaveBeenCalledWith(REAL_IP);
  });

  it('falls back to the per-IP limit alone when the body carries no usable email', async () => {
    authPostMock.mockResolvedValue(rejectedResponse());
    await POST(credentialsPost({ 'x-real-ip': REAL_IP, 'content-type': 'text/plain' }, 'junk'));
    await POST(
      credentialsPost({ 'x-real-ip': REAL_IP, 'content-type': 'application/json' }, '{"email":5}'),
    );
    await POST(
      credentialsPost({ 'x-real-ip': REAL_IP, 'content-type': 'application/json' }, 'not json'),
    );
    expect(rl.loginIpRateLimit).toHaveBeenCalledTimes(3);
    expect(rl.loginRateLimit).not.toHaveBeenCalled();
    expect(rl.recordLoginFailure).toHaveBeenCalledTimes(3);
  });

  it('the per-IP-only branch also refuses with 429 before NextAuth runs', async () => {
    rl.loginIpRateLimit.mockResolvedValue({ ok: false, remaining: 0, retryAfterSec: 61 });
    const res = await POST(
      credentialsPost({ 'x-real-ip': REAL_IP, 'content-type': 'text/plain' }, 'junk'),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('61');
    expect(authPostMock).not.toHaveBeenCalled();
    expect(rl.recordLoginFailure).not.toHaveBeenCalled();
  });

  it('leaves the NextAuth request body readable (the handler receives the credentials)', async () => {
    authPostMock.mockImplementation(async (req: NextRequest) => {
      const form = await req.formData();
      return form.get('email') === 'faculty@hmp.local' ? acceptedResponse() : rejectedResponse();
    });
    await POST(credentialsPost({ 'x-real-ip': REAL_IP }));
    expect(rl.recordLoginFailure).not.toHaveBeenCalled();
  });

  it('does not throttle other auth POSTs (session refresh, future SSO callbacks)', async () => {
    authPostMock.mockResolvedValue(new Response('{}', { status: 200 }));
    const res = await POST(
      credentialsPost(
        { 'x-real-ip': REAL_IP },
        undefined,
        'http://localhost:3000/api/auth/session',
      ),
    );
    expect(res.status).toBe(200);
    expect(rl.loginRateLimit).not.toHaveBeenCalled();
    expect(rl.loginIpRateLimit).not.toHaveBeenCalled();
    expect(rl.recordLoginFailure).not.toHaveBeenCalled();
  });
});

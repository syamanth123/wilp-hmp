import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SamlSetup } from '@/lib/saml/config';
import type { MatchCandidate } from '@/lib/saml/match-user';

const state = vi.hoisted(() => ({
  setup: { status: 'off' } as SamlSetup,
  users: [] as MatchCandidate[],
  roles: {} as Record<string, string[]>,
  signIn: vi.fn(async () => '/'),
  audit: vi.fn(async () => undefined),
  rateLimit: vi.fn(async () => ({ ok: true, remaining: 1, retryAfterSec: 0 })),
}));

vi.mock('@/lib/saml/config', async () => {
  const actual: Record<string, unknown> = await vi.importActual('@/lib/saml/config');
  return { ...actual, getSamlSetup: () => state.setup };
});
vi.mock('@hmp/auth', () => ({
  signIn: state.signIn,
  createSsoProof: async (userId: string) => `proof-for-${userId}`,
  authSecret: () => 'test-secret',
}));
vi.mock('@hmp/db', () => ({
  RoleName: {
    ADMIN: 'ADMIN',
    INSTRUCTION_CELL: 'INSTRUCTION_CELL',
    HOG: 'HOG',
    PROGRAMME_COMMITTEE: 'PROGRAMME_COMMITTEE',
    FACULTY: 'FACULTY',
    SME: 'SME',
  },
  prisma: {
    userRole: {
      findMany: async ({ where }: { where: { userId: string } }) =>
        (state.roles[where.userId] ?? []).map((name) => ({ role: { name } })),
    },
  },
}));
vi.mock('@/lib/saml/prisma-finder', () => ({
  prismaUserFinder: {
    byEmail: async (e: string) => state.users.find((u) => u.email.toLowerCase() === e) ?? null,
    byEmailLocalPart: async (lp: string) =>
      state.users.filter((u) => u.email.toLowerCase().startsWith(`${lp.toLowerCase()}@`)),
  },
}));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: state.rateLimit }));
vi.mock('@/lib/audit', () => ({ audit: state.audit }));

import { loadSamlSetup } from '@/lib/saml/config';
import { createSaml } from '@/lib/saml/sp';
import {
  idpMetadataXml,
  makeIdentity,
  makeResponse,
  requestIdFromUrl,
  spMetadataXml,
  type Identity,
} from '@/lib/saml/__tests__/fake-idp';
import { POST as acs } from '../acs/route';
import { GET as metadata } from '../metadata/route';
import { GET as login } from '../login/route';

let idp: Identity;
let okSetup: SamlSetup;

beforeAll(() => {
  process.env.NEXTAUTH_URL = 'https://hmp.test';
  const sp = makeIdentity('hmp.test');
  idp = makeIdentity('idp.test');
  const f: Record<string, string> = {
    '/k/sp.xml': spMetadataXml(sp.certB64),
    '/k/key.pem': sp.keyPem,
    '/k/cert.pem': sp.certPem,
    '/k/idp.xml': idpMetadataXml(idp.certB64),
  };
  okSetup = loadSamlSetup(
    {
      SAML_SP_METADATA_PATH: '/k/sp.xml',
      SAML_SP_KEY_PATH: '/k/key.pem',
      SAML_SP_CERT_PATH: '/k/cert.pem',
      SAML_IDP_METADATA_PATH: '/k/idp.xml',
      NEXTAUTH_URL: 'https://hmp.test',
    },
    (p) => Buffer.from(f[p]!),
  );
  expect(okSetup.status).toBe('ok');
}, 60_000);

beforeEach(() => {
  state.setup = okSetup;
  state.users = [
    { id: 'u-fac', email: 'faculty.one@pilani.bits-pilani.ac.in', active: true },
    { id: 'u-old', email: 'gone@pilani.bits-pilani.ac.in', active: false },
  ];
  state.roles = { 'u-fac': ['FACULTY'] };
  state.signIn.mockClear();
  state.audit.mockClear();
  state.rateLimit.mockClear();
});

async function postAcs(attributes: Record<string, string>, relay = ''): Promise<Response> {
  if (okSetup.status !== 'ok') throw new Error('setup');
  const id = requestIdFromUrl(await createSaml(okSetup.settings).getAuthorizeUrlAsync(relay, {}));
  const SAMLResponse = await makeResponse({ idp, inResponseTo: id, attributes });
  return acs(
    new NextRequest('https://hmp.test/api/saml/acs', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://idp.test' },
      body: new URLSearchParams({ SAMLResponse, RelayState: relay }),
    }),
  );
}

const auditActions = () =>
  state.audit.mock.calls.map((c) => (c as unknown as [{ action: string }])[0].action);

describe('POST /api/saml/acs', () => {
  it('signs a known user in (cross-site POST, no origin check) and goes to RelayState', async () => {
    const res = await postAcs(
      { mail: 'Faculty.One@pilani.bits-pilani.ac.in' },
      '/faculty/assignments',
    );
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('https://hmp.test/faculty/assignments');
    expect(state.signIn).toHaveBeenCalledWith(
      'bits-sso',
      expect.objectContaining({ proof: 'proof-for-u-fac', redirect: false }),
    );
    expect(auditActions()).toEqual(['auth.sso.login']);
  });

  it("goes to the user's home page when there is no RelayState", async () => {
    const res = await postAcs({ mail: 'faculty.one@pilani.bits-pilani.ac.in' });
    expect(res.headers.get('location')).toBe('https://hmp.test/faculty');
  });

  it('refuses a mail HMP does not know — no uid fallback — and audits the email only', async () => {
    const res = await postAcs({ mail: 'faculty.one@goa.bits-pilani.ac.in', uid: 'faculty.one' });
    expect(res.headers.get('location')).toBe('https://hmp.test/login?sso=not_set_up');
    expect(state.signIn).not.toHaveBeenCalled();
    const call = (state.audit.mock.calls[0] as unknown as [{ action: string; after: unknown }])[0];
    expect(call.action).toBe('auth.sso.refused');
    expect(call.after).toEqual({
      reason: 'unknown_mail',
      email: 'faculty.one@goa.bits-pilani.ac.in',
    });
  });

  it('uses the uid fallback only when no mail is sent', async () => {
    const res = await postAcs({ uid: 'faculty.one' });
    expect(res.headers.get('location')).toBe('https://hmp.test/faculty');
    expect(state.signIn).toHaveBeenCalledTimes(1);
  });

  it('refuses an inactive account', async () => {
    const res = await postAcs({ mail: 'gone@pilani.bits-pilani.ac.in' });
    expect(res.headers.get('location')).toBe('https://hmp.test/login?sso=inactive');
    expect(state.signIn).not.toHaveBeenCalled();
  });

  it('refuses a forged response and never signs in', async () => {
    if (okSetup.status !== 'ok') throw new Error('setup');
    const id = requestIdFromUrl(await createSaml(okSetup.settings).getAuthorizeUrlAsync('', {}));
    const forged = await makeResponse({
      idp: makeIdentity('attacker'),
      inResponseTo: id,
      attributes: { mail: 'faculty.one@pilani.bits-pilani.ac.in' },
    });
    const res = await acs(
      new NextRequest('https://hmp.test/api/saml/acs', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ SAMLResponse: forged }),
      }),
    );
    expect(res.headers.get('location')).toBe('https://hmp.test/login?sso=failed');
    expect(state.signIn).not.toHaveBeenCalled();
    expect(auditActions()).toEqual(['auth.sso.refused']);
  }, 30_000);

  it('drops an off-site RelayState', async () => {
    const res = await postAcs({ mail: 'faculty.one@pilani.bits-pilani.ac.in' }, '//evil.test/x');
    expect(res.headers.get('location')).toBe('https://hmp.test/faculty');
  });

  it('sends people back to the login page while SSO is off or rate-limited', async () => {
    state.setup = { status: 'off' };
    const off = await acs(new NextRequest('https://hmp.test/api/saml/acs', { method: 'POST' }));
    expect(off.headers.get('location')).toBe('https://hmp.test/login?sso=unavailable');

    state.setup = okSetup;
    state.rateLimit.mockResolvedValueOnce({ ok: false, remaining: 0, retryAfterSec: 60 });
    const busy = await acs(new NextRequest('https://hmp.test/api/saml/acs', { method: 'POST' }));
    expect(busy.headers.get('location')).toBe('https://hmp.test/login?sso=busy');
  });
});

describe('GET /api/saml/metadata', () => {
  it('serves the SP metadata file byte for byte', async () => {
    if (okSetup.status !== 'ok') throw new Error('setup');
    const res = await metadata();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/samlmetadata+xml');
    expect(Buffer.from(await res.arrayBuffer()).equals(okSetup.settings.spMetadataXml)).toBe(true);
  });

  it('is 404 while SSO is off', async () => {
    state.setup = { status: 'error', reason: 'x' };
    expect((await metadata()).status).toBe(404);
  });
});

describe('GET /api/saml/login', () => {
  it('redirects to the IdP with a signed request and a safe RelayState', async () => {
    const res = await login(new NextRequest('https://hmp.test/api/saml/login?next=/ic/requests'));
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get('location')!);
    expect(to.origin).toBe('https://idp.test');
    expect(to.searchParams.get('RelayState')).toBe('/ic/requests');
    expect(to.searchParams.get('Signature')).toBeTruthy();
  });

  it('never carries an off-site next', async () => {
    const res = await login(
      new NextRequest('https://hmp.test/api/saml/login?next=https://evil.test'),
    );
    expect(new URL(res.headers.get('location')!).searchParams.get('RelayState')).toBeNull();
  });

  it('goes back to the login page while SSO is off', async () => {
    state.setup = { status: 'off' };
    const res = await login(new NextRequest('https://hmp.test/api/saml/login'));
    expect(res.headers.get('location')).toBe('https://hmp.test/login?sso=unavailable');
  });
});

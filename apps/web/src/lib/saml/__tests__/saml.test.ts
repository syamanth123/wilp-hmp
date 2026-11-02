import { readFileSync } from 'node:fs';
import path from 'node:path';
import { verify } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadSamlSetup, type SamlSettings } from '../config';
import { parseSpMetadata } from '../metadata';
import { createSaml } from '../sp';
import { identityFromProfile } from '../attributes';
import {
  ACS,
  IDP_SSO,
  idpMetadataXml,
  makeIdentity,
  makeResponse,
  requestIdFromUrl,
  spMetadataXml,
  type Identity,
} from './fake-idp';

let sp: Identity;
let idp: Identity;
let other: Identity;

const ENV = {
  SAML_SP_METADATA_PATH: '/k/sp.xml',
  SAML_SP_KEY_PATH: '/k/sp-key.pem',
  SAML_SP_CERT_PATH: '/k/sp-cert.pem',
  SAML_IDP_METADATA_PATH: '/k/idp.xml',
  NEXTAUTH_URL: 'https://hmp.test',
};

function files(over: Record<string, string> = {}): (p: string) => Buffer {
  const base: Record<string, string> = {
    '/k/sp.xml': spMetadataXml(sp.certB64),
    '/k/sp-key.pem': sp.keyPem,
    '/k/sp-cert.pem': sp.certPem,
    '/k/idp.xml': idpMetadataXml(idp.certB64),
    ...over,
  };
  return (p) => {
    if (!(p in base)) throw new Error(`ENOENT ${p}`);
    return Buffer.from(base[p]!);
  };
}

function settings(): SamlSettings {
  const s = loadSamlSetup(ENV, files());
  if (s.status !== 'ok')
    throw new Error(`setup failed: ${s.status === 'error' ? s.reason : 'off'}`);
  return s.settings;
}

async function freshRequestId(s: SamlSettings): Promise<string> {
  return requestIdFromUrl(await createSaml(s).getAuthorizeUrlAsync('', {}));
}

beforeAll(() => {
  sp = makeIdentity('hmp.test');
  idp = makeIdentity('idp.test');
  other = makeIdentity('someone-else');
}, 60_000);

describe('the generated SP metadata file (the copy IT gets)', () => {
  it('parses to the planned entityID, ACS and signing settings', () => {
    const xml = readFileSync(path.join(__dirname, '__fixtures__/hmp-sp-metadata.xml'), 'utf8');
    const md = parseSpMetadata(xml);
    expect(md.entityId).toBe('https://hmp.wilp-connect.net/api/saml/metadata');
    expect(md.acsUrl).toBe('https://hmp.wilp-connect.net/api/saml/acs');
    expect(md.authnRequestsSigned).toBe(true);
    expect(md.wantAssertionsSigned).toBe(true);
    expect(md.signingCerts).toHaveLength(1);
    expect(md.encryptionCerts).toEqual(md.signingCerts);
    expect(xml).not.toMatch(/PRIVATE KEY/);
  });
});

describe('loadSamlSetup — files must agree, or SSO stays off', () => {
  it('is off (silently) when no SAML setting is present', () => {
    expect(loadSamlSetup({}, files())).toEqual({ status: 'off' });
  });

  it('loads a consistent set', () => {
    const s = loadSamlSetup(ENV, files());
    expect(s.status).toBe('ok');
    if (s.status !== 'ok') return;
    expect(s.settings.sp.acsUrl).toBe(ACS);
    expect(s.settings.idp.ssoRedirectUrl).toBe(IDP_SSO);
    expect(s.settings.spMetadataXml.toString()).toBe(spMetadataXml(sp.certB64));
  });

  const broken: [string, () => ReturnType<typeof loadSamlSetup>, RegExp][] = [
    [
      'a missing setting',
      () => loadSamlSetup({ ...ENV, SAML_SP_KEY_PATH: '' }, files()),
      /missing setting SAML_SP_KEY_PATH/,
    ],
    [
      'an unreadable file',
      () => loadSamlSetup({ ...ENV, SAML_SP_KEY_PATH: '/nope' }, files()),
      /cannot read/,
    ],
    [
      'a certificate that is not the one in the metadata',
      () => loadSamlSetup(ENV, files({ '/k/sp-cert.pem': other.certPem })),
      /not the one in the SP metadata/,
    ],
    [
      'a key that does not match the certificate',
      () => loadSamlSetup(ENV, files({ '/k/sp-key.pem': other.keyPem })),
      /does not match/,
    ],
    [
      'an ACS on another path',
      () =>
        loadSamlSetup(
          ENV,
          files({
            '/k/sp.xml': spMetadataXml(sp.certB64, { acs: 'https://hmp.test/api/auth/saml/acs' }),
          }),
        ),
      /ACS path/,
    ],
    [
      'an http entityID',
      () =>
        loadSamlSetup(
          ENV,
          files({
            '/k/sp.xml': spMetadataXml(sp.certB64, {
              entityId: 'http://hmp.test/api/saml/metadata',
            }),
          }),
        ),
      /https/,
    ],
    [
      'an app address on another site',
      () => loadSamlSetup({ ...ENV, NEXTAUTH_URL: 'https://other.test' }, files()),
      /NEXTAUTH_URL/,
    ],
    [
      'an expired certificate',
      () => loadSamlSetup(ENV, files(), Date.now() + 365 * 86_400_000),
      /expired/,
    ],
    [
      'IdP metadata without a redirect endpoint',
      () =>
        loadSamlSetup(
          ENV,
          files({
            '/k/idp.xml': idpMetadataXml(idp.certB64).replace(
              /<SingleSignOnService[^>]*Redirect[^>]*\/>/,
              '',
            ),
          }),
        ),
      /HTTP-Redirect/,
    ],
  ];
  it.each(broken)('refuses %s', (_name, run, reason) => {
    const s = run();
    expect(s.status).toBe('error');
    if (s.status === 'error') expect(s.reason).toMatch(reason);
  });
});

describe('sign-in request', () => {
  it('goes to the IdP by HTTP-Redirect, signed RSA-SHA256 with our key, carrying RelayState', async () => {
    const s = settings();
    const url = await createSaml(s).getAuthorizeUrlAsync('/faculty', {});
    expect(url.startsWith(`${IDP_SSO}?`)).toBe(true);
    const q = new URL(url).searchParams;
    expect(q.get('SigAlg')).toBe('http://www.w3.org/2001/04/xmldsig-more#rsa-sha256');
    expect(q.get('RelayState')).toBe('/faculty');
    // The signature covers the raw query parts in this order (SAML bindings §3.4.4.1).
    const raw = url.split('?')[1]!.split('&');
    const signed = ['SAMLRequest=', 'RelayState=', 'SigAlg=']
      .map((p) => raw.find((r) => r.startsWith(p))!)
      .join('&');
    expect(
      verify('sha256', Buffer.from(signed), sp.certPem, Buffer.from(q.get('Signature')!, 'base64')),
    ).toBe(true);
    expect(requestIdFromUrl(url)).toMatch(/^_/);
  });
});

describe('validating the IdP response (fake IdP, no network)', () => {
  const MAIL = { mail: 'Faculty.One@Pilani.Bits-Pilani.ac.in', uid: 'faculty.one' };

  it('accepts a signed assertion that answers our request, and reads mail/uid (not NameID)', async () => {
    const s = settings();
    const id = await freshRequestId(s);
    const res = await makeResponse({
      idp,
      inResponseTo: id,
      attributes: MAIL,
      nameId: 'admin@hmp.test',
    });
    const { profile } = await createSaml(s).validatePostResponseAsync({ SAMLResponse: res });
    expect(identityFromProfile(profile as Record<string, unknown>)).toEqual({
      mail: 'faculty.one@pilani.bits-pilani.ac.in',
      uid: 'faculty.one',
    });
  });

  it('accepts an encrypted assertion (rsa-oaep-mgf1p + aes256-gcm)', async () => {
    const s = settings();
    const id = await freshRequestId(s);
    const res = await makeResponse({
      idp,
      inResponseTo: id,
      attributes: MAIL,
      encryptTo: sp.certPem,
    });
    const { profile } = await createSaml(s).validatePostResponseAsync({ SAMLResponse: res });
    expect(identityFromProfile(profile as Record<string, unknown>).mail).toBe(
      'faculty.one@pilani.bits-pilani.ac.in',
    );
  });

  it('rejects a replay of an accepted response', async () => {
    const s = settings();
    const id = await freshRequestId(s);
    const res = await makeResponse({ idp, inResponseTo: id, attributes: MAIL });
    await createSaml(s).validatePostResponseAsync({ SAMLResponse: res });
    await expect(createSaml(s).validatePostResponseAsync({ SAMLResponse: res })).rejects.toThrow();
  });

  const bad: [string, (id: string) => Promise<string>][] = [
    [
      'a tampered attribute (bad signature)',
      (id) =>
        makeResponse({
          idp,
          inResponseTo: id,
          attributes: MAIL,
          tamper: (x) => x.replace('faculty.one', 'admin'),
        }),
    ],
    [
      'an assertion signed by someone else',
      (id) => makeResponse({ idp: other, inResponseTo: id, attributes: MAIL }),
    ],
    [
      'an unsigned assertion',
      (id) => makeResponse({ idp, inResponseTo: id, attributes: MAIL, signAssertion: false }),
    ],
    [
      'a signed envelope around an unsigned assertion',
      (id) =>
        makeResponse({
          idp,
          inResponseTo: id,
          attributes: MAIL,
          signAssertion: false,
          signResponse: true,
        }),
    ],
    [
      'another audience',
      (id) =>
        makeResponse({
          idp,
          inResponseTo: id,
          attributes: MAIL,
          audience: 'https://elearn.test/shibboleth',
        }),
    ],
    [
      'an expired assertion',
      (id) => makeResponse({ idp, inResponseTo: id, attributes: MAIL, validForMin: -10 }),
    ],
    [
      'an answer to a request we never sent',
      () => makeResponse({ idp, inResponseTo: '_not-ours', attributes: MAIL }),
    ],
  ];
  it.each(bad)('rejects %s', async (_name, build) => {
    const s = settings();
    const res = await build(await freshRequestId(s));
    await expect(createSaml(s).validatePostResponseAsync({ SAMLResponse: res })).rejects.toThrow();
  });
});

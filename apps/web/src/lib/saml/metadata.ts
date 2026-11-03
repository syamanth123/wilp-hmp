import { DOMParser } from '@xmldom/xmldom';

/**
 * Reads the two SAML metadata files HMP's SSO is configured from: our own SP metadata (the file
 * IT registered — generated on the server by make-hmp-sp-metadata.sh) and the BITS IdP's
 * metadata. Pure: XML text in, plain values out; throws a readable Error on anything missing.
 */

const MD = 'urn:oasis:names:tc:SAML:2.0:metadata';
const DS = 'http://www.w3.org/2000/09/xmldsig#';
const HTTP_POST = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST';
const HTTP_REDIRECT = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect';

export interface SpMetadata {
  entityId: string;
  /** The HTTP-POST AssertionConsumerService location. */
  acsUrl: string;
  /** Base64 DER, whitespace removed. */
  signingCerts: string[];
  encryptionCerts: string[];
  authnRequestsSigned: boolean;
  wantAssertionsSigned: boolean;
}

export interface IdpMetadata {
  entityId: string;
  /** SingleSignOnService location for the HTTP-Redirect binding. */
  ssoRedirectUrl: string;
  /** Certificates the IdP signs with (KeyDescriptor use="signing" or no use). */
  signingCerts: string[];
}

type El = {
  getAttribute(name: string): string | null;
  getElementsByTagNameNS(ns: string, name: string): ArrayLike<El>;
  textContent: string | null;
};

function parse(xml: string, what: string): El {
  const errors: string[] = [];
  const doc = new DOMParser({
    errorHandler: {
      error: (m: string) => errors.push(m),
      fatalError: (m: string) => errors.push(m),
    },
  }).parseFromString(xml, 'text/xml');
  const root = doc?.documentElement as unknown as El | null;
  if (errors.length || !root) throw new Error(`${what} is not valid XML`);
  return root;
}

function all(el: El, ns: string, name: string): El[] {
  return Array.from(el.getElementsByTagNameNS(ns, name));
}

function entityDescriptor(root: El, what: string): El {
  const ed =
    (root as unknown as { localName?: string }).localName === 'EntityDescriptor'
      ? root
      : all(root, MD, 'EntityDescriptor')[0];
  const entityId = ed?.getAttribute('entityID');
  if (!ed || !entityId) throw new Error(`${what} has no EntityDescriptor entityID`);
  return ed;
}

function certs(role: El, use: 'signing' | 'encryption'): string[] {
  return all(role, MD, 'KeyDescriptor')
    .filter((kd) => {
      const u = kd.getAttribute('use');
      return !u || u === use;
    })
    .flatMap((kd) => all(kd, DS, 'X509Certificate'))
    .map((c) => (c.textContent ?? '').replace(/\s+/g, ''))
    .filter(Boolean);
}

const truthy = (v: string | null) => v === 'true' || v === '1';

export function parseSpMetadata(xml: string): SpMetadata {
  const what = 'SP metadata';
  const ed = entityDescriptor(parse(xml, what), what);
  const sp = all(ed, MD, 'SPSSODescriptor')[0];
  if (!sp) throw new Error(`${what} has no SPSSODescriptor`);
  const acs = all(sp, MD, 'AssertionConsumerService').filter(
    (a) => a.getAttribute('Binding') === HTTP_POST,
  );
  if (acs.length !== 1 || !acs[0]!.getAttribute('Location')) {
    throw new Error(`${what} must have exactly one HTTP-POST AssertionConsumerService`);
  }
  return {
    entityId: ed.getAttribute('entityID')!,
    acsUrl: acs[0]!.getAttribute('Location')!,
    signingCerts: certs(sp, 'signing'),
    encryptionCerts: certs(sp, 'encryption'),
    authnRequestsSigned: truthy(sp.getAttribute('AuthnRequestsSigned')),
    wantAssertionsSigned: truthy(sp.getAttribute('WantAssertionsSigned')),
  };
}

export function parseIdpMetadata(xml: string): IdpMetadata {
  const what = 'IdP metadata';
  const ed = entityDescriptor(parse(xml, what), what);
  const idp = all(ed, MD, 'IDPSSODescriptor')[0];
  if (!idp) throw new Error(`${what} has no IDPSSODescriptor`);
  const sso = all(idp, MD, 'SingleSignOnService').find(
    (s) => s.getAttribute('Binding') === HTTP_REDIRECT,
  );
  const ssoRedirectUrl = sso?.getAttribute('Location');
  if (!ssoRedirectUrl) throw new Error(`${what} has no HTTP-Redirect SingleSignOnService`);
  const signingCerts = certs(idp, 'signing');
  if (!signingCerts.length) throw new Error(`${what} has no signing certificate`);
  return { entityId: ed.getAttribute('entityID')!, ssoRedirectUrl, signingCerts };
}

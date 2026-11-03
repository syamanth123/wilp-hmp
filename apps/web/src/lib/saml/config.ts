import { readFileSync } from 'node:fs';
import { createPrivateKey, createPublicKey, X509Certificate } from 'node:crypto';
import { parseIdpMetadata, parseSpMetadata, type IdpMetadata, type SpMetadata } from './metadata';

/**
 * BITS SSO settings, read from four files on the server (never from git):
 *
 *   SAML_SP_METADATA_PATH  our SP metadata — the exact file IT registered
 *   SAML_SP_KEY_PATH       our private key (signs AuthnRequests, decrypts assertions)
 *   SAML_SP_CERT_PATH      our certificate (must be the one inside the SP metadata)
 *   SAML_IDP_METADATA_PATH the BITS IdP's metadata (downloaded once at install)
 *
 * The entityID, ACS URL and certificate come FROM the SP metadata file, so the code can't drift
 * from what IT registered. Any mismatch turns SSO off with one clear log line; password login
 * is unaffected. HMP never creates a key pair.
 */

export const ACS_PATH = '/api/saml/acs';

export interface SamlSettings {
  sp: SpMetadata;
  idp: IdpMetadata;
  spKeyPem: string;
  spCertPem: string;
  /** The SP metadata file's exact bytes (served at /api/saml/metadata). */
  spMetadataXml: Buffer;
}

export type SamlSetup =
  | { status: 'off' }
  | { status: 'error'; reason: string }
  | { status: 'ok'; settings: SamlSettings };

type Env = Record<string, string | undefined>;
type Read = (path: string) => Buffer;

const SETTINGS = [
  'SAML_SP_METADATA_PATH',
  'SAML_SP_KEY_PATH',
  'SAML_SP_CERT_PATH',
  'SAML_IDP_METADATA_PATH',
] as const;

const spki = (k: ReturnType<typeof createPublicKey>) =>
  k.export({ type: 'spki', format: 'der' }).toString('base64');

function isHttps(url: string): URL | null {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

export function loadSamlSetup(
  env: Env = process.env,
  read: Read = (p) => readFileSync(p),
  nowMs: number = Date.now(),
): SamlSetup {
  const paths = SETTINGS.map((k) => (env[k] ?? '').trim());
  if (paths.every((p) => !p)) return { status: 'off' };
  const missing = SETTINGS.filter((_, i) => !paths[i]);
  if (missing.length) return { status: 'error', reason: `missing setting ${missing.join(', ')}` };

  const [spMetaPath, keyPath, certPath, idpMetaPath] = paths as [string, string, string, string];
  let files: { spMeta: Buffer; key: Buffer; cert: Buffer; idpMeta: Buffer };
  try {
    files = {
      spMeta: read(spMetaPath),
      key: read(keyPath),
      cert: read(certPath),
      idpMeta: read(idpMetaPath),
    };
  } catch (e) {
    return { status: 'error', reason: `cannot read a SAML file (${(e as Error).message})` };
  }

  let sp: SpMetadata;
  let idp: IdpMetadata;
  try {
    sp = parseSpMetadata(files.spMeta.toString('utf8'));
    idp = parseIdpMetadata(files.idpMeta.toString('utf8'));
  } catch (e) {
    return { status: 'error', reason: (e as Error).message };
  }

  const entity = isHttps(sp.entityId);
  const acs = isHttps(sp.acsUrl);
  if (!entity || !acs) return { status: 'error', reason: 'SP entityID and ACS must be https URLs' };
  if (acs.pathname !== ACS_PATH) {
    return { status: 'error', reason: `SP ACS path is ${acs.pathname}, HMP serves ${ACS_PATH}` };
  }
  if (acs.origin !== entity.origin) {
    return { status: 'error', reason: 'SP entityID and ACS are on different sites' };
  }
  const appUrl = isHttps(env.NEXTAUTH_URL ?? '');
  if (appUrl && appUrl.origin !== acs.origin) {
    return {
      status: 'error',
      reason: `SP ACS is on ${acs.origin} but NEXTAUTH_URL is ${appUrl.origin}`,
    };
  }
  if (!sp.authnRequestsSigned || !sp.wantAssertionsSigned) {
    return {
      status: 'error',
      reason: 'SP metadata must set AuthnRequestsSigned and WantAssertionsSigned to true',
    };
  }

  let cert: X509Certificate;
  try {
    cert = new X509Certificate(files.cert);
  } catch {
    return { status: 'error', reason: 'SAML_SP_CERT_PATH is not a certificate' };
  }
  if (!sp.signingCerts.includes(cert.raw.toString('base64'))) {
    return { status: 'error', reason: 'the certificate file is not the one in the SP metadata' };
  }
  if (Date.parse(cert.validTo) < nowMs) {
    return { status: 'error', reason: `the SP certificate expired on ${cert.validTo}` };
  }
  try {
    if (spki(createPublicKey(createPrivateKey(files.key))) !== spki(cert.publicKey)) {
      return { status: 'error', reason: 'the private key does not match the certificate' };
    }
  } catch {
    return { status: 'error', reason: 'SAML_SP_KEY_PATH is not a private key' };
  }

  return {
    status: 'ok',
    settings: {
      sp,
      idp,
      spKeyPem: files.key.toString('utf8'),
      spCertPem: cert.toString(),
      spMetadataXml: files.spMeta,
    },
  };
}

let cached: SamlSetup | null = null;

/** The setup for this server process, loaded once; logs why SSO is off if it is broken. */
export function getSamlSetup(): SamlSetup {
  if (!cached) {
    cached = loadSamlSetup();
    if (cached.status === 'error') {
      console.error(`[saml] BITS sign-in is OFF: ${cached.reason}. Password login is unaffected.`);
    }
  }
  return cached;
}

/** Tests only. */
export function resetSamlSetupCache(): void {
  cached = null;
}

import { InMemoryCacheProvider, SAML, ValidateInResponseTo } from '@node-saml/node-saml';
import type { SamlSettings } from './config';

/**
 * The node-saml client for BITS SSO, built from the settings read out of the metadata files.
 *
 * - AuthnRequests go by HTTP-Redirect, signed RSA-SHA256 (our metadata says AuthnRequestsSigned).
 * - The assertion must be signed by a certificate from the IdP's metadata; the response envelope
 *   need not be (Shibboleth signs the assertion). Encrypted assertions are decrypted with our key.
 * - Every response must answer a request we sent (InResponseTo, kept 5 minutes and consumed on
 *   use), and each assertion ID is accepted once (replays rejected). 2 minutes of clock skew.
 *
 * Request IDs and assertion IDs live in this process's memory: HMP runs as ONE `next start`
 * process. If it ever runs as several, give them a shared store (Redis) instead.
 */

export const REQUEST_ID_TTL_MS = 5 * 60 * 1000;
export const CLOCK_SKEW_MS = 2 * 60 * 1000;
const TRANSIENT = 'urn:oasis:names:tc:SAML:2.0:nameid-format:transient';

// One cache per process, shared by every SAML instance (they are built per settings object).
const cache = new InMemoryCacheProvider({ keyExpirationPeriodMs: REQUEST_ID_TTL_MS });

export function createSaml(s: SamlSettings): SAML {
  return new SAML({
    issuer: s.sp.entityId,
    audience: s.sp.entityId,
    callbackUrl: s.sp.acsUrl,
    entryPoint: s.idp.ssoRedirectUrl,
    idpIssuer: s.idp.entityId,
    idpCert: s.idp.signingCerts,
    privateKey: s.spKeyPem,
    decryptionPvk: s.spKeyPem,
    signatureAlgorithm: 'sha256',
    digestAlgorithm: 'sha256',
    authnRequestBinding: 'HTTP-Redirect',
    identifierFormat: TRANSIENT,
    // Shibboleth decides how the user authenticates; don't ask for a specific context.
    disableRequestedAuthnContext: true,
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    acceptedClockSkewMs: CLOCK_SKEW_MS,
    validateInResponseTo: ValidateInResponseTo.always,
    requestIdExpirationPeriodMs: REQUEST_ID_TTL_MS,
    rejectReplayedAssertions: true,
    cacheProvider: cache,
  });
}

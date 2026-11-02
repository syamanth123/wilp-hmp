/**
 * Proof that the SAML endpoint (/api/saml/acs) has just verified a BITS sign-in for a user.
 *
 * The ACS route validates the IdP's response, picks the HMP user, then calls
 * `signIn('bits-sso', { proof })` IN THE SAME REQUEST. That proof never reaches the browser; the
 * `bits-sso` provider accepts nothing else. It is an HMAC over the user id and a 30-second expiry,
 * keyed from the Auth.js secret (with a purpose label, so it can never be mistaken for a session
 * token), so a direct POST to /api/auth/callback/bits-sso can't forge one.
 *
 * Web Crypto only (no node:crypto): this module is reachable from the Edge middleware bundle.
 */

const PURPOSE = 'hmp:bits-sso-proof:v1';
export const SSO_PROOF_TTL_MS = 30_000;

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string) {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(`${PURPOSE}:${secret}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/** The Auth.js secret, as Auth.js itself reads it. */
export function authSecret(env: Record<string, string | undefined> = process.env): string {
  return env.AUTH_SECRET ?? env.NEXTAUTH_SECRET ?? '';
}

export async function createSsoProof(
  userId: string,
  secret: string,
  nowMs: number = Date.now(),
): Promise<string> {
  if (!secret) throw new Error('No Auth.js secret configured');
  const payload = new TextEncoder().encode(
    JSON.stringify({ u: userId, exp: nowMs + SSO_PROOF_TTL_MS }),
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), payload));
  return `${b64url(payload)}.${b64url(sig)}`;
}

/** The user id the proof was made for, or null if it is malformed, forged or expired. */
export async function verifySsoProof(
  proof: unknown,
  secret: string,
  nowMs: number = Date.now(),
): Promise<string | null> {
  if (!secret || typeof proof !== 'string') return null;
  const parts = proof.split('.');
  if (parts.length !== 2) return null;
  try {
    const payload = fromB64url(parts[0]!);
    const sig = fromB64url(parts[1]!);
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), sig, payload);
    if (!ok) return null;
    const { u, exp } = JSON.parse(new TextDecoder().decode(payload)) as {
      u?: unknown;
      exp?: unknown;
    };
    if (typeof u !== 'string' || !u || typeof exp !== 'number' || exp < nowMs) return null;
    return u;
  } catch {
    return null;
  }
}

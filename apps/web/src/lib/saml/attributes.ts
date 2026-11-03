/**
 * The two identity attributes HMP uses from a BITS assertion. Shibboleth names attributes by OID
 * (with a FriendlyName beside it); node-saml keys the profile by Name, so read the OID first and
 * the friendly name as a fallback. Multi-valued attributes use the first value. NameID is never
 * used (it is transient — a new random value on every sign-in).
 */

export const MAIL_OID = 'urn:oid:0.9.2342.19200300.100.1.3';
export const UID_OID = 'urn:oid:0.9.2342.19200300.100.1.1';

function first(v: unknown): string | null {
  const x = Array.isArray(v) ? v[0] : v;
  if (typeof x !== 'string') return null;
  const t = x.trim();
  return t ? t : null;
}

export function identityFromProfile(profile: Record<string, unknown>): {
  mail: string | null;
  uid: string | null;
} {
  const attrs = (profile.attributes ?? {}) as Record<string, unknown>;
  const pick = (oid: string, friendly: string) =>
    first(profile[oid]) ?? first(attrs[oid]) ?? first(profile[friendly]) ?? first(attrs[friendly]);
  const mail = pick(MAIL_OID, 'mail');
  return { mail: mail ? mail.toLowerCase() : null, uid: pick(UID_OID, 'uid') };
}

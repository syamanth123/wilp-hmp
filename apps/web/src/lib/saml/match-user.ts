/**
 * Which HMP account a BITS sign-in belongs to (decided 2 Nov 2026):
 *
 * - `mail` sent → the account with that email (case-insensitive). No match → REFUSED: we never
 *   fall back to `uid` here, or `amit@goa…` could land in `amit@pilani…`'s account. The
 *   Instruction Cell fixes such cases by correcting the email in HMP.
 * - `mail` NOT sent → `uid` fallback: the one account whose email starts with `<uid>@`. Zero or
 *   several → refused.
 * - The account must be active. Roles always come from HMP, never from the IdP.
 */

export interface MatchCandidate {
  id: string;
  email: string;
  active: boolean;
}

export type MatchRefusal =
  | 'no_identity'
  | 'unknown_mail'
  | 'unknown_uid'
  | 'uid_not_unique'
  | 'inactive';

export type MatchResult =
  | { ok: true; userId: string; email: string; via: 'mail' | 'uid' }
  | { ok: false; reason: MatchRefusal; email: string | null };

export interface UserFinder {
  byEmail(email: string): Promise<MatchCandidate | null>;
  /** Accounts whose email starts with `<prefix>@` (case-insensitive). */
  byEmailLocalPart(localPart: string): Promise<MatchCandidate[]>;
}

const UID_SHAPE = /^[A-Za-z0-9._-]{1,64}$/;

export async function matchSsoUser(
  identity: { mail: string | null; uid: string | null },
  find: UserFinder,
): Promise<MatchResult> {
  if (identity.mail) {
    const email = identity.mail.toLowerCase();
    const user = await find.byEmail(email);
    if (!user) return { ok: false, reason: 'unknown_mail', email };
    if (!user.active) return { ok: false, reason: 'inactive', email: user.email };
    return { ok: true, userId: user.id, email: user.email, via: 'mail' };
  }
  if (identity.uid && UID_SHAPE.test(identity.uid)) {
    const users = await find.byEmailLocalPart(identity.uid);
    if (users.length === 0) return { ok: false, reason: 'unknown_uid', email: null };
    if (users.length > 1) return { ok: false, reason: 'uid_not_unique', email: null };
    const user = users[0]!;
    if (!user.active) return { ok: false, reason: 'inactive', email: user.email };
    return { ok: true, userId: user.id, email: user.email, via: 'uid' };
  }
  return { ok: false, reason: 'no_identity', email: null };
}

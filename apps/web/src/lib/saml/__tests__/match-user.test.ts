import { describe, expect, it } from 'vitest';
import { matchSsoUser, type MatchCandidate, type UserFinder } from '../match-user';
import { safeNextPath } from '../relay';
import { ssoMessage } from '../messages';
import { identityFromProfile, MAIL_OID, UID_OID } from '../attributes';

const USERS: MatchCandidate[] = [
  { id: 'u1', email: 'amit@pilani.bits-pilani.ac.in', active: true },
  { id: 'u2', email: 'ravi@goa.bits-pilani.ac.in', active: true },
  { id: 'u3', email: 'ravi@hyderabad.bits-pilani.ac.in', active: true },
  { id: 'u4', email: 'old@pilani.bits-pilani.ac.in', active: false },
];

const finder: UserFinder = {
  async byEmail(email) {
    return USERS.find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null;
  },
  async byEmailLocalPart(lp) {
    return USERS.filter((u) => u.email.toLowerCase().startsWith(`${lp.toLowerCase()}@`));
  },
};

describe('matchSsoUser — mail first, uid only when mail is absent', () => {
  it('signs in by mail, case-insensitively', async () => {
    expect(await matchSsoUser({ mail: 'AMIT@Pilani.bits-pilani.ac.in', uid: 'x' }, finder)).toEqual(
      {
        ok: true,
        userId: 'u1',
        email: 'amit@pilani.bits-pilani.ac.in',
        via: 'mail',
      },
    );
  });

  it('refuses an unknown mail and does NOT fall back to uid (other campus, same uid)', async () => {
    const r = await matchSsoUser({ mail: 'amit@goa.bits-pilani.ac.in', uid: 'amit' }, finder);
    expect(r).toEqual({ ok: false, reason: 'unknown_mail', email: 'amit@goa.bits-pilani.ac.in' });
  });

  it('falls back to uid when no mail is sent and exactly one account matches', async () => {
    expect(await matchSsoUser({ mail: null, uid: 'amit' }, finder)).toMatchObject({
      ok: true,
      userId: 'u1',
      via: 'uid',
    });
  });

  it('refuses a uid that matches several accounts, or none', async () => {
    expect(await matchSsoUser({ mail: null, uid: 'ravi' }, finder)).toMatchObject({
      ok: false,
      reason: 'uid_not_unique',
    });
    expect(await matchSsoUser({ mail: null, uid: 'nobody' }, finder)).toMatchObject({
      ok: false,
      reason: 'unknown_uid',
    });
  });

  it('refuses an inactive account by either route', async () => {
    expect(
      await matchSsoUser({ mail: 'old@pilani.bits-pilani.ac.in', uid: null }, finder),
    ).toMatchObject({ ok: false, reason: 'inactive' });
    expect(await matchSsoUser({ mail: null, uid: 'old' }, finder)).toMatchObject({
      ok: false,
      reason: 'inactive',
    });
  });

  it('refuses when neither attribute is usable', async () => {
    expect(await matchSsoUser({ mail: null, uid: null }, finder)).toMatchObject({
      ok: false,
      reason: 'no_identity',
    });
    expect(await matchSsoUser({ mail: null, uid: 'a b%' }, finder)).toMatchObject({
      ok: false,
      reason: 'no_identity',
    });
  });
});

describe('identityFromProfile', () => {
  it('reads OID-named attributes, falls back to friendly names, lowercases mail, ignores NameID', () => {
    expect(
      identityFromProfile({ nameID: 'x@y', [MAIL_OID]: 'A@B.C', [UID_OID]: ['u1', 'u2'] }),
    ).toEqual({ mail: 'a@b.c', uid: 'u1' });
    expect(identityFromProfile({ attributes: { mail: ' m@x ', uid: 'v' } })).toEqual({
      mail: 'm@x',
      uid: 'v',
    });
    expect(identityFromProfile({ nameID: 'x@y' })).toEqual({ mail: null, uid: null });
  });
});

describe('safeNextPath', () => {
  it.each(['/faculty', '/ic/requests?status=REQUESTED', '/hog/requests/abc'])('keeps %s', (p) => {
    expect(safeNextPath(p)).toBe(p);
  });
  it.each([
    'https://evil.test/',
    '//evil.test',
    '/\\evil.test',
    'faculty',
    '/login',
    '/login?next=/x',
    '/api/saml/acs',
    '',
    null,
    42,
  ])('drops %s', (p) => {
    expect(safeNextPath(p)).toBeNull();
  });
});

describe('ssoMessage', () => {
  it('has a message for every code the SAML routes send, and none for unknown ones', () => {
    for (const c of ['not_set_up', 'inactive', 'failed', 'unavailable', 'busy'])
      expect(ssoMessage(c)).toBeTruthy();
    expect(ssoMessage('constructor')).toBeNull();
    expect(ssoMessage(undefined)).toBeNull();
  });
});

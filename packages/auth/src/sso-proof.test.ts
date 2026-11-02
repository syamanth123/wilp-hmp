import { describe, expect, it } from 'vitest';
import { authSecret, createSsoProof, SSO_PROOF_TTL_MS, verifySsoProof } from './sso-proof';

const SECRET = 'test-secret-0123456789';
const NOW = 1_800_000_000_000;

describe('SSO proof', () => {
  it('round-trips the user id within its lifetime', async () => {
    const proof = await createSsoProof('user-1', SECRET, NOW);
    expect(await verifySsoProof(proof, SECRET, NOW)).toBe('user-1');
    expect(await verifySsoProof(proof, SECRET, NOW + SSO_PROOF_TTL_MS)).toBe('user-1');
  });

  it('expires after 30 seconds', async () => {
    const proof = await createSsoProof('user-1', SECRET, NOW);
    expect(await verifySsoProof(proof, SECRET, NOW + SSO_PROOF_TTL_MS + 1)).toBeNull();
  });

  it('rejects another secret, a swapped user id and a tampered signature', async () => {
    const proof = await createSsoProof('user-1', SECRET, NOW);
    expect(await verifySsoProof(proof, 'other-secret', NOW)).toBeNull();

    const [, sig] = proof.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ u: 'admin', exp: NOW + 10_000 })).toString(
      'base64url',
    );
    expect(await verifySsoProof(`${forgedPayload}.${sig}`, SECRET, NOW)).toBeNull();

    const flipped = proof.slice(0, -2) + (proof.endsWith('AA') ? 'BB' : 'AA');
    expect(await verifySsoProof(flipped, SECRET, NOW)).toBeNull();
  });

  it('rejects junk and an empty secret', async () => {
    for (const junk of [undefined, null, 42, '', 'a.b.c', 'no-dot', '%%%.%%%']) {
      expect(await verifySsoProof(junk, SECRET, NOW)).toBeNull();
    }
    const proof = await createSsoProof('user-1', SECRET, NOW);
    expect(await verifySsoProof(proof, '', NOW)).toBeNull();
    await expect(createSsoProof('user-1', '', NOW)).rejects.toThrow();
  });

  it('reads the secret the way Auth.js does (AUTH_SECRET first)', () => {
    expect(authSecret({ AUTH_SECRET: 'a', NEXTAUTH_SECRET: 'b' })).toBe('a');
    expect(authSecret({ NEXTAUTH_SECRET: 'b' })).toBe('b');
    expect(authSecret({})).toBe('');
  });
});

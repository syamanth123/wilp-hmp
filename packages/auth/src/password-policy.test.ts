import { describe, expect, it } from 'vitest';
import { passwordLoginAllowed, passwordLoginOpenToAll } from './password-policy';

const SSO = { SAML_SP_METADATA_PATH: '/home/ubuntu/hmp-saml/hmp-sp-metadata.xml' };

describe('password login policy', () => {
  it('is open to everyone while SSO is not set up on the server (no lock-out)', () => {
    expect(passwordLoginOpenToAll({})).toBe(true);
    expect(passwordLoginAllowed(['FACULTY'], {})).toBe(true);
    expect(passwordLoginAllowed([], { PASSWORD_LOGIN_ENABLED: 'false' })).toBe(true);
  });

  it('is open to everyone with PASSWORD_LOGIN_ENABLED=true, even with SSO set up', () => {
    const env = { ...SSO, PASSWORD_LOGIN_ENABLED: 'true' };
    expect(passwordLoginOpenToAll(env)).toBe(true);
    expect(passwordLoginAllowed(['FACULTY'], env)).toBe(true);
    expect(passwordLoginAllowed(['SME'], { ...SSO, PASSWORD_LOGIN_ENABLED: ' TRUE ' })).toBe(true);
  });

  it('is for administrators only once SSO is set up and password login is not enabled', () => {
    for (const env of [SSO, { ...SSO, PASSWORD_LOGIN_ENABLED: 'false' }]) {
      expect(passwordLoginOpenToAll(env)).toBe(false);
      expect(passwordLoginAllowed(['ADMIN'], env)).toBe(true);
      expect(passwordLoginAllowed(['FACULTY', 'ADMIN'], env)).toBe(true);
      expect(passwordLoginAllowed(['FACULTY'], env)).toBe(false);
      expect(passwordLoginAllowed(['INSTRUCTION_CELL', 'HOG'], env)).toBe(false);
      expect(passwordLoginAllowed([], env)).toBe(false);
    }
  });
});

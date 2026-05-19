/**
 * SSO Provider abstraction.
 *
 * The real BITS IdP integration (SAML or OIDC) plugs in here behind this interface.
 * For dev we use a credentials-based stub. To swap, implement `SsoProvider` and
 * register it via `getSsoProvider()`.
 */

export interface SsoUserProfile {
  subject: string;
  email: string;
  name: string;
  /** Optional groups/claims that may map to roles. */
  groups?: string[];
}

export interface SsoProvider {
  readonly id: string;
  /** Returns the URL the user should be redirected to for SSO. */
  getAuthorizationUrl(state: string): Promise<string>;
  /** Exchanges the IdP response (code/SAMLResponse) for a user profile. */
  exchange(params: Record<string, string>): Promise<SsoUserProfile>;
}

/**
 * Stub provider — fails closed. Real implementations should validate signatures,
 * verify issuer, check audience, and expire tokens.
 */
class StubSsoProvider implements SsoProvider {
  readonly id = 'stub';
  async getAuthorizationUrl(): Promise<string> {
    throw new Error('SSO not configured. Use credentials login in dev.');
  }
  async exchange(): Promise<SsoUserProfile> {
    throw new Error('SSO not configured.');
  }
}

let _provider: SsoProvider = new StubSsoProvider();

export function getSsoProvider(): SsoProvider {
  return _provider;
}

export function registerSsoProvider(p: SsoProvider): void {
  _provider = p;
}

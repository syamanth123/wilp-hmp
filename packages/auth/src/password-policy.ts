import type { RoleName } from '@hmp/db';

/**
 * Who may sign in with email + password.
 *
 * - `PASSWORD_LOGIN_ENABLED=true` → everyone (the setting during the SSO roll-out).
 * - BITS SSO not set up on this server (no `SAML_SP_METADATA_PATH`) → everyone, so a server
 *   without SSO can never lock its users out.
 * - Otherwise (SSO set up, password login not enabled) → administrators only, as a fallback.
 */
export function passwordLoginOpenToAll(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if ((env.PASSWORD_LOGIN_ENABLED ?? '').trim().toLowerCase() === 'true') return true;
  return !(env.SAML_SP_METADATA_PATH ?? '').trim();
}

export function passwordLoginAllowed(
  roles: readonly RoleName[] | readonly string[],
  env: Record<string, string | undefined> = process.env,
): boolean {
  return passwordLoginOpenToAll(env) || roles.includes('ADMIN' as RoleName);
}

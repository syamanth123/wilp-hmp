/**
 * An absolute URL on HMP's public address. Built from NEXTAUTH_URL / APP_BASE_URL — never from
 * the request's Host header — so a forged Host can't steer a post-sign-in redirect elsewhere.
 */
export function appUrl(
  path: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const base = env.NEXTAUTH_URL || env.APP_BASE_URL || 'http://localhost:3000';
  return new URL(path, base).toString();
}

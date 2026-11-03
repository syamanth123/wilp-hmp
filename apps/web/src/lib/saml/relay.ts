/**
 * The page to open after a BITS sign-in, carried through the IdP as RelayState. Only a path on
 * this site is accepted — never another host (`//evil`, `/\evil`, `https://…`) — so the sign-in
 * flow can't be used to bounce people to someone else's site.
 */
export function safeNextPath(next: unknown): string | null {
  if (typeof next !== 'string') return null;
  const p = next.trim();
  if (!p.startsWith('/') || p.startsWith('//') || p.includes('\\')) return null;
  if (p.length > 512 || [...p].some((c) => c.charCodeAt(0) < 32)) return null;
  if (p === '/login' || p.startsWith('/login?') || p.startsWith('/api/')) return null;
  return p;
}

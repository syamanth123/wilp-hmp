/**
 * Client IP for rate-limit keys (login throttle).
 *
 * Trust order:
 *   1. `X-Real-IP` — our nginx (deploy/nginx.conf) sets it to `$remote_addr`,
 *      the TCP peer address. `proxy_set_header` REPLACES whatever the visitor
 *      sent, so this value cannot be forged from outside.
 *   2. The LAST `X-Forwarded-For` entry — the address the nearest trusted proxy
 *      appended (`$proxy_add_x_forwarded_for`). The FIRST entry is whatever the
 *      visitor put in the header themselves and must never become a key: an
 *      attacker could pick a fresh "IP" per request and never trip a per-IP
 *      limit.
 *   3. `'unknown'` — neither header present.
 *
 * TRUST BOUNDARY: this is only sound behind a proxy that REWRITES both headers
 * (deploy/nginx.conf does). Without one — a bare `next start`, port 3000
 * reachable directly, a second ingress — the values are visitor-controlled:
 * Next itself fills `X-Forwarded-For` with the socket peer only when the
 * request carries none, and keeps a visitor-supplied one as-is, so the per-IP
 * cap degrades to advisory there. The per-username cap does not depend on
 * this. If a load balancer or CDN is ever placed in front of nginx,
 * `$remote_addr` becomes the balancer's address: nginx then needs
 * `set_real_ip_from` + `real_ip_header X-Forwarded-For` first, or every
 * visitor shares one key.
 *
 * Accepts both a Fetch `Headers` (Route Handlers) and next/headers'
 * ReadonlyHeaders (server actions) — anything with `.get(name)`.
 */
export function clientIpFromHeaders(h: Pick<Headers, 'get'>): string {
  const real = h.get('x-real-ip')?.trim();
  if (real) return real;
  const forwarded = h.get('x-forwarded-for');
  if (forwarded) {
    const hops = forwarded
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const last = hops[hops.length - 1];
    if (last) return last;
  }
  return 'unknown';
}

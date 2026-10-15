import { describe, it, expect } from 'vitest';
import { clientIpFromHeaders } from './client-ip';

describe('clientIpFromHeaders', () => {
  it('prefers X-Real-IP (set by nginx to $remote_addr) over anything in X-Forwarded-For', () => {
    const h = new Headers({ 'x-real-ip': '10.0.0.7', 'x-forwarded-for': '1.2.3.4, 10.0.0.7' });
    expect(clientIpFromHeaders(h)).toBe('10.0.0.7');
  });

  it('a spoofed X-Forwarded-For does not change the key when X-Real-IP is present', () => {
    const honest = new Headers({ 'x-real-ip': '10.0.0.7' });
    const spoofed = new Headers({ 'x-real-ip': '10.0.0.7', 'x-forwarded-for': '1.2.3.4' });
    expect(clientIpFromHeaders(spoofed)).toBe(clientIpFromHeaders(honest));
  });

  it('without X-Real-IP uses the LAST X-Forwarded-For hop (proxy-appended), never the first', () => {
    const h = new Headers({ 'x-forwarded-for': '1.2.3.4, 203.0.113.9, 10.0.0.7' });
    expect(clientIpFromHeaders(h)).toBe('10.0.0.7');
  });

  it('DOCUMENTED LIMIT: with neither header rewritten by a proxy, a lone visitor-supplied hop is trusted', () => {
    // Behind deploy/nginx.conf this shape cannot reach the app (nginx replaces
    // both headers). Without that proxy the per-IP cap is advisory only.
    expect(clientIpFromHeaders(new Headers({ 'x-forwarded-for': '1.2.3.4' }))).toBe('1.2.3.4');
  });

  it('trims whitespace and ignores empty entries', () => {
    expect(clientIpFromHeaders(new Headers({ 'x-forwarded-for': ' 1.2.3.4 , , ' }))).toBe(
      '1.2.3.4',
    );
    expect(clientIpFromHeaders(new Headers({ 'x-real-ip': '  10.0.0.7  ' }))).toBe('10.0.0.7');
  });

  it('an empty X-Real-IP falls through to X-Forwarded-For, then to "unknown"', () => {
    expect(
      clientIpFromHeaders(new Headers({ 'x-real-ip': '', 'x-forwarded-for': '10.0.0.7' })),
    ).toBe('10.0.0.7');
    expect(clientIpFromHeaders(new Headers({ 'x-real-ip': ' ', 'x-forwarded-for': ' , ' }))).toBe(
      'unknown',
    );
    expect(clientIpFromHeaders(new Headers())).toBe('unknown');
  });

  it('accepts any object with get() (next/headers ReadonlyHeaders)', () => {
    const h = { get: (name: string) => (name === 'x-real-ip' ? '10.0.0.7' : null) };
    expect(clientIpFromHeaders(h)).toBe('10.0.0.7');
  });
});

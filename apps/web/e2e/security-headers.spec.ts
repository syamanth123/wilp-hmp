import { test, expect, type Page } from '@playwright/test';

// Prompt 20: security headers + CSP. Verifies the static headers are present on
// document responses and that the per-request nonce'd CSP has the right shape
// (nonce + strict-dynamic in script-src, NO unsafe-inline for scripts;
// unsafe-inline only for styles; only Google Fonts as external origins). The
// console-error listener doubles as the CSP-break detector: if the CSP blocks a
// legitimate Next.js script, the browser logs a CSP violation → the test fails.
// Runs anywhere (no MinIO/Redis needed).

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

test('static security headers are present on document responses', async ({ page }) => {
  await signIn(page, 'admin@hmp.local');
  const resp = await page.goto('/admin');
  expect(resp).not.toBeNull();
  const h = resp!.headers();
  expect(h['strict-transport-security']).toContain('max-age=63072000');
  expect(h['x-frame-options']).toBe('DENY');
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(h['permissions-policy']).toContain('geolocation=()');
});

test('CSP header has the intended shape (nonce script-src, no script unsafe-inline)', async ({
  page,
}) => {
  await signIn(page, 'admin@hmp.local');
  const resp = await page.goto('/admin');
  const csp = resp!.headers()['content-security-policy'] ?? '';
  expect(csp).toBeTruthy();

  const directives = Object.fromEntries(
    csp
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => {
        const [name, ...vals] = d.split(/\s+/);
        return [name, vals.join(' ')];
      }),
  ) as Record<string, string>;

  // script-src: nonce + strict-dynamic, and crucially NO unsafe-inline/unsafe-eval.
  expect(directives['script-src']).toMatch(/'nonce-[^']+'/);
  expect(directives['script-src']).not.toContain("'unsafe-inline'");
  expect(directives['script-src']).not.toContain("'unsafe-eval'");
  // style-src: unsafe-inline is allowed (login + ProseMirror inline styles).
  expect(directives['style-src']).toContain("'unsafe-inline'");
  // Only Google Fonts as external origins.
  expect(directives['style-src']).toContain('https://fonts.googleapis.com');
  expect(directives['font-src']).toContain('https://fonts.gstatic.com');
  expect(directives['frame-ancestors']).toBe("'none'");
  expect(directives['object-src']).toBe("'none'");
});

test('no CSP violations across core authed pages', async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(`${err.name}: ${err.message}`));

  // NOTE: not waitForLoadState('networkidle') — the notification bell holds a
  // long-lived SSE connection (/api/notifications/stream) open on every authed
  // page, so the network is never idle. goto() waits for 'load' (scripts
  // executed — when a CSP script-block would fire); a short settle catches any
  // late violations.
  await signIn(page, 'admin@hmp.local');
  for (const path of ['/admin', '/admin/ai-metrics', '/admin/users']) {
    await page.goto(path); // default waitUntil: 'load'
    await page.waitForTimeout(800);
  }

  // This test's purpose is CSP-break detection. A CSP that blocks a legitimate
  // script logs "Refused to ... because it violates the following Content
  // Security Policy directive". We assert specifically on CSP-violation
  // messages — NOT every console error: rapid programmatic navigation makes
  // Next abort in-flight RSC prefetches ("Failed to fetch RSC payload …
  // Falling back to browser navigation"), which is benign harness noise, not a
  // security problem. Uncaught JS exceptions (pageerror) are still a hard fail.
  const cspViolations = consoleErrors.filter((e) => /content security policy/i.test(e));
  expect(cspViolations, `CSP violations:\n${cspViolations.join('\n')}`).toEqual([]);
  expect(pageErrors, `uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([]);
});

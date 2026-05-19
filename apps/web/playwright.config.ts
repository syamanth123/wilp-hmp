import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // Sequential. Next.js dev mode compiles per-route on first hit (multi-second
  // cost); running tests in parallel makes every worker race the same first
  // compile and exhausts timeouts. With a single worker, each route compiles
  // once, then every subsequent test hits the warm cache.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'html',
  // First-compile latency in Next.js dev mode can exceed the default 5s for
  // `expect()` web-first assertions and ~30s for actions/navigation. CI sees
  // similar (cold cache) and the existing dev-server `webServer.timeout` is
  // already 180s — keep these consistent.
  timeout: 90_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },
  webServer: {
    // In CI we serve a production build (`next start`). Dev mode's per-route
    // first-compile under load + RSC streaming hiccups cause server actions
    // to occasionally log "failed to forward action response" and leave the
    // client's `useTransition` in success state even though the underlying
    // commit/revalidate didn't propagate — manifests as flaky downstream
    // assertions. Production builds are pre-compiled and stable.
    //
    // Local dev keeps `pnpm dev` for hot reload — CI runs a single `pnpm build`
    // (in the e2e job, before playwright) and `pnpm start` serves it.
    command: process.env.CI
      ? 'pnpm --filter @hmp/web start'
      : 'pnpm --filter @hmp/web dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});

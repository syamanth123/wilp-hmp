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
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});

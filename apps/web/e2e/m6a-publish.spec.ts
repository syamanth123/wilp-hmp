import { test, expect, type Page } from '@playwright/test';
import { seedHandoutAtStatus, cleanupTestHandouts } from './fixtures/handout';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

// m6 originally walked IC → HOG → PC → Faculty → PC → HOG → IC publish → archive
// in a single 8-step test. Under CI load that single test occasionally flaked
// on the trailing publish/archive assertions. This split puts publish into its
// own spec that starts from a seeded APPROVED state (see fixtures/handout.ts)
// so the single user action under test runs with no upstream-flake exposure.
test.describe('IC publish', () => {
  let requestId: string;

  test.beforeEach(async () => {
    const { requestId: id } = await seedHandoutAtStatus({ status: 'APPROVED' });
    requestId = id;
  });

  test.afterEach(async () => {
    await cleanupTestHandouts();
  });

  test('IC publishes an approved handout to LMS', async ({ page }) => {
    await signIn(page, 'ic@hmp.local');
    await page.goto(`/ic/requests/${requestId}`);

    // No `waitForLoadState('networkidle')` — the page opens a long-lived SSE
    // connection to /api/notifications/stream, so 'networkidle' never fires
    // within Playwright's timeout. The next `expect.toBeVisible` auto-polls
    // and handles waiting for content.
    await expect(page.getByText(/^Approved$/).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Publish to LMS' })).toBeVisible();

    // Action.
    await page.getByRole('button', { name: /publish to lms/i }).click();

    // Persistent post-action signal: the Archive card *only* renders when
    // status === PUBLISHED (gated server-side in ic/requests/[id]/page.tsx).
    // Seeing this heading is a positive proof the transition committed AND
    // the page re-fetched the new state. Single durable assertion.
    await expect(
      page.getByRole('heading', { name: 'Archive', exact: true }),
    ).toBeVisible({ timeout: 30_000 });

    // Now that the post-publish UI is up, the rest of the assertions are
    // cheap consistency checks.
    await expect(page.getByText(/^Published$/).first()).toBeVisible();
    await expect(page.getByText(/taxila-stub/i)).toBeVisible();
  });
});

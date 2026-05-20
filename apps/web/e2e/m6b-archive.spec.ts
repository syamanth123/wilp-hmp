import { test, expect, type Page } from '@playwright/test';
import { seedHandoutAtStatus, cleanupTestHandouts } from './fixtures/handout';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

// Archive step, isolated from the publish step. Runs against a PUBLISHED
// fixture (LmsPublishLog already present, IC_PUBLISH approval already
// recorded) so the only thing this test exercises is the archive transition.
test.describe('IC archive', () => {
  let requestId: string;

  test.beforeEach(async () => {
    const { requestId: id } = await seedHandoutAtStatus({ status: 'PUBLISHED' });
    requestId = id;
  });

  test.afterEach(async () => {
    await cleanupTestHandouts();
  });

  test('IC archives a published handout', async ({ page }) => {
    await signIn(page, 'ic@hmp.local');
    await page.goto(`/ic/requests/${requestId}`);

    // No `waitForLoadState('networkidle')` — the page opens a long-lived SSE
    // connection to /api/notifications/stream, so 'networkidle' never fires
    // within Playwright's timeout. The next `expect.toBeVisible` auto-polls
    // and handles waiting for content.
    await expect(page.getByText(/^Published$/).first()).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Archive', exact: true }),
    ).toBeVisible();

    // Action.
    await page
      .getByLabel(/I understand this moves the handout to ARCHIVED/i)
      .check();
    await page.getByRole('button', { name: /archive this handout/i }).click();

    // Persistent post-action signal: the Archive card disappears entirely
    // when status === ARCHIVED (it's server-gated by status === PUBLISHED).
    // Card heading vanishing is a positive proof the transition committed
    // AND the page re-fetched.
    await expect(
      page.getByRole('heading', { name: 'Archive', exact: true }),
    ).toBeHidden({ timeout: 30_000 });
    await expect(page.getByText(/^Archived$/).first()).toBeVisible();
  });
});

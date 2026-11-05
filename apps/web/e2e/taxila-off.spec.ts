import { test, expect } from '@playwright/test';
import { cleanupTestHandouts, seedHandoutAtStatus } from './fixtures/handout';

// Taxila OFF (no TAXILA_URL / TAXILA_TOKEN — the main e2e run): no Taxila button anywhere; the IC
// gets today's ZIP export (review of PR #49, point 3). The "e2e (Taxila on)" step skips this file.
test.describe('Taxila off', () => {
  test.skip(!!process.env.TAXILA_URL && !!process.env.TAXILA_TOKEN, 'Taxila is on in this step');

  let requestId = '';
  test.beforeAll(async () => {
    requestId = (await seedHandoutAtStatus({ status: 'APPROVED' })).requestId;
  });
  test.afterAll(async () => {
    await cleanupTestHandouts();
  });

  test('no Taxila panel or bulk publish; the ZIP export is offered', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('ic@hmp.local');
    await page.getByLabel('Password').fill('password');
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL((url) => !url.pathname.startsWith('/login'));

    await page.goto(`/ic/requests/${requestId}`);
    await expect(page.getByRole('button', { name: 'Publish to LMS' })).toBeVisible();
    await expect(
      page.getByText('a file to upload to Taxila yourself', { exact: false }),
    ).toBeVisible();
    await expect(page.getByTestId('taxila-panel')).toHaveCount(0);
    await expect(page.getByTestId('taxila-check')).toHaveCount(0);

    await page.goto('/handouts?tab=published&view=not-published');
    await expect(page.getByTestId('list-total')).toBeVisible();
    await expect(page.getByTestId('bulk-publish-bar')).toHaveCount(0);
    await expect(page.getByTestId('bulk-select')).toHaveCount(0);
  });
});

import { test, expect, type Page } from '@playwright/test';
import { seedHandoutAtStatus, cleanupTestHandouts } from './fixtures/handout';

// Security: an SME may open only the handouts they are the assigned SME for.
// Before the fix, /sme/review/{id} showed the full handout, attachments and
// discussion to ANY SME and only hid the decision panel.
//
//   - assigned SME (sme@hmp.local)  → sees the handout
//   - a different SME               → "You don't have access", no content
//   - admin                         → unchanged, sees any handout
//
// The "different SME" case assigns the handout to another user, then signs in
// as the seeded SME, who is an SME but not the assigned one.

const HANDOUT_TEXT = 'Fixture content for E2E.';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

test.describe('SME review page — only the assigned SME can open a handout', () => {
  test.afterEach(async () => {
    await cleanupTestHandouts();
  });

  test('the assigned SME can open the handout', async ({ page }) => {
    const { requestId } = await seedHandoutAtStatus({ status: 'SME_REVIEW' });
    await signIn(page, 'sme@hmp.local');
    await page.goto(`/sme/review/${requestId}`);
    await expect(page.getByText(HANDOUT_TEXT)).toBeVisible();
    await expect(page.getByTestId('access-denied')).toHaveCount(0);
  });

  test('a different SME is refused and sees nothing of the handout', async ({ page }) => {
    const { requestId, refNo } = await seedHandoutAtStatus({
      status: 'SME_REVIEW',
      smeEmail: 'faculty2@hmp.local',
    });
    await signIn(page, 'sme@hmp.local');
    await page.goto(`/sme/review/${requestId}`);
    await expect(page.getByTestId('access-denied')).toBeVisible();
    await expect(page.getByText("You don't have access to this page")).toBeVisible();
    await expect(page.getByText(HANDOUT_TEXT)).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(refNo);
  });

  test('admin is unchanged and can open any handout', async ({ page }) => {
    const { requestId } = await seedHandoutAtStatus({
      status: 'SME_REVIEW',
      smeEmail: 'faculty2@hmp.local',
    });
    await signIn(page, 'admin@hmp.local');
    await page.goto(`/sme/review/${requestId}`);
    await expect(page.getByText(HANDOUT_TEXT)).toBeVisible();
    await expect(page.getByTestId('access-denied')).toHaveCount(0);
  });
});

import { test, expect, type Page } from '@playwright/test';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

async function signOut(page: Page) {
  await page.context().clearCookies();
}

// Comment-thread test, relocated verbatim from the original
// m6-publish-archive.spec.ts when that file was split into m6a/m6b/m6c.
// Logic unchanged on purpose — the publish/archive flake fix should not
// regress unrelated coverage. If this test starts flaking under the same
// upstream-walk pressure, follow up with a fixture-based rewrite (see
// e2e/fixtures/handout.ts for the pattern).
test('Faculty and PC can exchange comments on a request', async ({ page }) => {
  // Quickly set up a request to ASSIGNED so a handout exists.
  await signIn(page, 'ic@hmp.local');
  await page.goto('/ic/requests/new');
  await page.getByLabel('Programme').selectOption({ index: 1 });
  await page.getByLabel('Semester').selectOption({ index: 1 });
  await page.getByLabel('Course').selectOption({ index: 1 });
  await page.getByRole('button', { name: /create request/i }).click();
  await page.waitForURL(/\/ic\/requests\/c[a-z0-9]{20,}/i);
  const requestId = page.url().split('/').pop()!;
  await signOut(page);

  await signIn(page, 'hog@hmp.local');
  await page.goto(`/hog/requests/${requestId}`);
  await page
    .locator('label', { hasText: 'faculty@hmp.local' })
    .locator('input[type=checkbox]')
    .check();
  // Prompt 12-b: SME is mandatory at allocation. Pick the first seeded SME.
  await page.getByTestId('sme-picker').selectOption({ index: 1 });
  await page.getByRole('button', { name: /allocate/i }).click();
  await expect(page.getByText(/ALLOCATED/i).first()).toBeVisible({ timeout: 10_000 });
  await signOut(page);

  await signIn(page, 'pc@hmp.local');
  await page.goto(`/pc/requests/${requestId}`);
  await page.getByRole('button', { name: /confirm assignment/i }).click();
  await expect(page.getByText(/ASSIGNED/i).first()).toBeVisible({ timeout: 10_000 });

  // PC posts a comment. The textarea text alone would match `getByText` even
  // if the post action raced — assert the textarea CLEARS (the real success
  // signal) so we know the server action committed before we navigate away.
  await page.getByLabel('Add a comment').fill('Please double-check Bloom alignment.');
  await page.getByRole('button', { name: /post comment/i }).click();
  await expect(page.getByLabel('Add a comment')).toHaveValue('', { timeout: 15_000 });
  await expect(page.locator('li', { hasText: 'Please double-check Bloom alignment.' })).toBeVisible(
    { timeout: 10_000 },
  );
  await signOut(page);

  // Faculty sees PC's comment and replies.
  await signIn(page, 'faculty@hmp.local');
  await page.goto(`/faculty/assignments/${requestId}`);
  await expect(page.locator('li', { hasText: 'Please double-check Bloom alignment.' })).toBeVisible(
    { timeout: 15_000 },
  );
  await page.getByLabel('Add a comment').fill('Updated Bloom levels for objectives 2 and 3.');
  await page.getByRole('button', { name: /post comment/i }).click();
  await expect(page.getByLabel('Add a comment')).toHaveValue('', { timeout: 15_000 });
  await expect(page.locator('li', { hasText: 'Updated Bloom levels' })).toBeVisible({
    timeout: 10_000,
  });
});

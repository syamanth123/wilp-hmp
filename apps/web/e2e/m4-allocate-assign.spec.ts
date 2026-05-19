import { test, expect } from '@playwright/test';

async function signIn(page: import('@playwright/test').Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

async function signOut(page: import('@playwright/test').Page) {
  await page.goto('/api/auth/signout');
  await page.getByRole('button', { name: /sign out/i }).click().catch(() => {});
  await page.context().clearCookies();
}

test('IC creates → HOG allocates → PC confirms → status ASSIGNED', async ({ page }) => {
  // 1. IC creates a request.
  await signIn(page, 'ic@hmp.local');
  await page.goto('/ic/requests/new');
  await page.getByLabel('Programme').selectOption({ index: 1 });
  await page.getByLabel('Semester').selectOption({ index: 1 });
  await page.getByLabel('Course').selectOption({ index: 1 });
  await page.getByRole('button', { name: /create request/i }).click();
  // Cuids start with 'c' and are 25 chars; required because /ic/requests/new
  // would otherwise match `[a-z0-9]+` and the test would proceed with id="new".
  await page.waitForURL(/\/ic\/requests\/c[a-z0-9]{20,}/i);
  const refNo = await page.locator('text=/HMP-\\d{4}-\\d{4}/').first().textContent();
  expect(refNo).toBeTruthy();
  const requestId = page.url().split('/').pop()!;

  await signOut(page);

  // 2. HOG allocates a faculty.
  await signIn(page, 'hog@hmp.local');
  await page.goto(`/hog/requests/${requestId}`);
  await expect(page.getByText('Allocate faculty')).toBeVisible();
  // Pick the on-campus faculty deterministically (matches the seeded user the
  // downstream specs sign in as).
  await page
    .locator('label', { hasText: 'faculty@hmp.local' })
    .locator('input[type=checkbox]')
    .check();
  await page.getByRole('button', { name: /allocate/i }).click();
  await expect(page.getByText(/ALLOCATED/i).first()).toBeVisible({ timeout: 10_000 });

  await signOut(page);

  // 3. PC confirms the assignment.
  await signIn(page, 'pc@hmp.local');
  await page.goto(`/pc/requests/${requestId}`);
  // `getByText` would match both the card heading and the button — use role
  // to disambiguate.
  await expect(page.getByRole('button', { name: /confirm assignment/i })).toBeVisible();
  await page.getByRole('button', { name: /confirm assignment/i }).click();
  await expect(page.getByText(/ASSIGNED/i).first()).toBeVisible({ timeout: 10_000 });
});

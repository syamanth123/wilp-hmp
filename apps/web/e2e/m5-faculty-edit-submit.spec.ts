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

test('Faculty accepts, edits, saves a version, and submits', async ({ page }) => {
  // 1. IC creates a request.
  await signIn(page, 'ic@hmp.local');
  await page.goto('/ic/requests/new');
  await page.getByLabel('Programme').selectOption({ index: 1 });
  await page.getByLabel('Semester').selectOption({ index: 1 });
  await page.getByLabel('Course').selectOption({ index: 1 });
  await page.getByRole('button', { name: /create request/i }).click();
  await page.waitForURL(/\/ic\/requests\/c[a-z0-9]{20,}/i);
  const requestId = page.url().split('/').pop()!;
  await signOut(page);

  // 2. HOG allocates the on-campus faculty (the user we sign in as below).
  await signIn(page, 'hog@hmp.local');
  await page.goto(`/hog/requests/${requestId}`);
  await page
    .locator('label', { hasText: 'faculty@hmp.local' })
    .locator('input[type=checkbox]')
    .check();
  await page.getByRole('button', { name: /allocate/i }).click();
  await expect(page.getByText(/ALLOCATED/i).first()).toBeVisible({ timeout: 10_000 });
  await signOut(page);

  // 3. PC confirms.
  await signIn(page, 'pc@hmp.local');
  await page.goto(`/pc/requests/${requestId}`);
  await page.getByRole('button', { name: /confirm assignment/i }).click();
  await expect(page.getByText(/ASSIGNED/i).first()).toBeVisible({ timeout: 10_000 });
  await signOut(page);

  // 4. Faculty accepts, starts editing, saves, submits.
  await signIn(page, 'faculty@hmp.local');
  await page.goto(`/faculty/assignments/${requestId}`);
  await page.getByRole('button', { name: /accept assignment/i }).click();
  await page.getByRole('button', { name: /start editing/i }).click();
  await expect(page.getByText(/IN_PROGRESS/i).first()).toBeVisible({ timeout: 10_000 });

  // Type into the TipTap editor.
  const editor = page.locator('.ProseMirror').first();
  await editor.click();
  await editor.type(' — edited by faculty E2E');

  await page.getByRole('button', { name: /save version/i }).click();
  await expect(page.getByText(/Saved v\d+/)).toBeVisible({ timeout: 10_000 });

  await page.getByRole('button', { name: /submit for review/i }).click();
  // The editor-panel's transient success message ("Submitted. The PC will
  // now review…") is replaced by the read-only viewer the moment revalidate
  // re-fetches. Assert on the persistent status badge instead.
  await expect(page.getByText(/^Submitted$/).first()).toBeVisible({ timeout: 15_000 });
});

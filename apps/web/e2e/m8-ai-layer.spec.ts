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

// All M8 E2E paths assume NO AI keys are set (CI default). The recommender
// must still render in heuristic-only mode and the quality panel must surface
// a friendly "not configured" message.

test('HOG sees the AI suggestions panel in heuristic-only mode', async ({ page }) => {
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

  // 2. HOG opens the request → AI suggestions section visible.
  await signIn(page, 'hog@hmp.local');
  await page.goto(`/hog/requests/${requestId}`);
  await expect(page.getByText(/AI suggestions/i)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Heuristic-only/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /regenerate/i })).toBeVisible();
});

test('Faculty quality panel surfaces a friendly error without AI keys', async ({ page }) => {
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

  // 4. Faculty accepts, starts editing, clicks "Run quality check".
  await signIn(page, 'faculty@hmp.local');
  await page.goto(`/faculty/assignments/${requestId}`);
  await page.getByRole('button', { name: /accept assignment/i }).click();
  await page.getByRole('button', { name: /start editing/i }).click();
  await page.getByRole('button', { name: /run quality check/i }).click();
  await expect(page.getByText(/AI provider not configured/i)).toBeVisible({ timeout: 10_000 });
});

test('Admin AI metrics page renders provider status + corpus controls', async ({ page }) => {
  await signIn(page, 'admin@hmp.local');
  await page.goto('/admin/ai-metrics');
  await expect(page.getByRole('heading', { name: /provider status/i })).toBeVisible();
  await expect(page.getByText(/Not configured/i).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: /embedding corpus/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /re-embed all/i })).toBeVisible();
});

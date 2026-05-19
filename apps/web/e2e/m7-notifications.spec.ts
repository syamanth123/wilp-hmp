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

test('Workflow events surface in the in-portal notification bell', async ({ page }) => {
  // IC initiates a request.
  await signIn(page, 'ic@hmp.local');
  await page.goto('/ic/requests/new');
  await page.getByLabel('Programme').selectOption({ index: 1 });
  await page.getByLabel('Semester').selectOption({ index: 1 });
  await page.getByLabel('Course').selectOption({ index: 1 });
  await page.getByRole('button', { name: /create request/i }).click();
  await page.waitForURL(/\/ic\/requests\/c[a-z0-9]{20,}/i);
  await signOut(page);

  // HOG should see a notification for the new request.
  await signIn(page, 'hog@hmp.local');
  await page.goto('/hog');
  await page.getByRole('button', { name: /notifications/i }).click();
  await expect(page.getByText(/New handout request/i).first()).toBeVisible({ timeout: 15_000 });
});

test('Admin can run the SLA reminder sweep on demand', async ({ page }) => {
  await signIn(page, 'admin@hmp.local');
  await page.goto('/admin/notifications');
  await page.getByRole('button', { name: /run reminder sweep now/i }).click();
  await expect(page.getByText(/Scanned \d+ active requests/i)).toBeVisible({ timeout: 15_000 });
});

test('Notifications list page renders for a signed-in user', async ({ page }) => {
  await signIn(page, 'hog@hmp.local');
  await page.goto('/notifications');
  await expect(page.getByRole('heading', { name: /notifications/i })).toBeVisible();
});

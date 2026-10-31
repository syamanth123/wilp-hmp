import { test, expect } from '@playwright/test';

// Security: the login page must not advertise the demo accounts or pre-fill a
// login unless SHOW_DEMO_LOGINS=true (never set in CI or on a real server).
test('login page shows no demo accounts and nothing pre-filled', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByLabel('Email')).toHaveValue('');
  await expect(page.getByLabel('Password')).toHaveValue('');
  await expect(page.getByTestId('demo-logins')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('admin@hmp.local');
  await expect(page.locator('body')).not.toContainText(/password is/i);
});

test('admin can log in and lands on admin console', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@hmp.local');
  await page.getByLabel('Password').fill('password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/admin/);
});

test('faculty cannot access admin area', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('faculty@hmp.local');
  await page.getByLabel('Password').fill('password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/faculty/);
  await page.goto('/admin');
  await expect(page.getByText(/403/i)).toBeVisible();
});

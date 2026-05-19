import { test, expect } from '@playwright/test';

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

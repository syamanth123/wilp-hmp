import { test, expect } from '@playwright/test';

test('IC creates a handout request end-to-end', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('ic@hmp.local');
  await page.getByLabel('Password').fill('password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/ic/);

  await page.goto('/ic/requests/new');
  await expect(page.getByText('New handout request')).toBeVisible();

  // Cascading selects — pick the first available option at each level.
  const programmeSelect = page.getByLabel('Programme');
  const programmeOptions = await programmeSelect.locator('option').allTextContents();
  expect(programmeOptions.length).toBeGreaterThan(1);
  await programmeSelect.selectOption({ index: 1 });

  const semesterSelect = page.getByLabel('Semester');
  await semesterSelect.selectOption({ index: 1 });

  const courseSelect = page.getByLabel('Course');
  await courseSelect.selectOption({ index: 1 });

  await page.getByRole('button', { name: /create request/i }).click();

  await page.waitForURL(/\/ic\/requests\/c[a-z0-9]{20,}/i);
  await expect(page.locator('text=/HMP-\\d{4}-\\d{4}/')).toBeVisible();
  await expect(page.getByText(/REQUESTED/i).first()).toBeVisible();
});

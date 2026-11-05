import { test, expect } from '@playwright/test';
import { prisma } from '@hmp/db';

// Creates a real request, so it removes everything it made afterwards — the request (its handout,
// assignments and approvals cascade), the notifications that link to it and its audit rows — and
// can't leave data behind in a demo database, even when it fails half-way.
let startedAt = new Date();

test.beforeEach(() => {
  startedAt = new Date();
});

test.afterEach(async () => {
  const made = await prisma.handoutRequest.findMany({
    where: { createdAt: { gte: startedAt }, initiator: { email: 'ic@hmp.local' } },
    select: { id: true },
  });
  for (const { id } of made) {
    await prisma.notification.deleteMany({ where: { link: { contains: id } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: id }, { requestId: id }] } });
    await prisma.handoutRequest.delete({ where: { id } });
  }
});

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
  await expect(page.locator('[data-status="REQUESTED"]').first()).toBeVisible();
});

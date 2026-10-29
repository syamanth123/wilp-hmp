import { test, expect, type Page } from '@playwright/test';
import { seedHandoutAtStatus, cleanupTestHandouts } from './fixtures/handout';

// AI features sit behind one switch, AI_FEATURES_ENABLED (default off).
// This spec checks both settings. Each half skips itself when the server runs
// with the other setting:
//   - the main e2e run has the switch off  → "AI switched off" runs
//   - the "e2e (AI on)" CI step sets it on → "AI switched on" runs
// The test process and the server it starts share the step's environment.
//
// With the switch on, CI still has no AI keys (AI_PROVIDER=noop), so the
// recommender runs in heuristic-only mode and the quality panel shows its
// friendly "not configured" message.

const AI_ON = process.env.AI_FEATURES_ENABLED === 'true';

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

async function icCreatesRequest(page: Page): Promise<string> {
  await signIn(page, 'ic@hmp.local');
  await page.goto('/ic/requests/new');
  await page.getByLabel('Programme').selectOption({ index: 1 });
  await page.getByLabel('Semester').selectOption({ index: 1 });
  await page.getByLabel('Course').selectOption({ index: 1 });
  await page.getByRole('button', { name: /create request/i }).click();
  await page.waitForURL(/\/ic\/requests\/c[a-z0-9]{20,}/i);
  const requestId = page.url().split('/').pop()!;
  await signOut(page);
  return requestId;
}

test.describe('AI switched off (default)', () => {
  test.skip(AI_ON, 'runs only when AI_FEATURES_ENABLED is off');

  test.afterEach(async () => {
    await cleanupTestHandouts();
  });

  test('HOG allocation shows no AI suggestions', async ({ page }) => {
    const requestId = await icCreatesRequest(page);
    await signIn(page, 'hog@hmp.local');
    await page.goto(`/hog/requests/${requestId}`);
    // The allocation panel is there (pick faculty by hand) …
    await expect(page.getByTestId('sme-picker')).toBeVisible({ timeout: 10_000 });
    // … but no AI suggestions and no way to regenerate them.
    await expect(page.getByText(/AI suggestions/i)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /regenerate/i })).toHaveCount(0);
  });

  test('faculty see no AI quality check or AI draft, editing or submitted', async ({ page }) => {
    const editing = await seedHandoutAtStatus({ status: 'IN_PROGRESS' });
    const submitted = await seedHandoutAtStatus({ status: 'SME_REVIEW' });
    await signIn(page, 'faculty@hmp.local');

    await page.goto(`/faculty/assignments/${editing.requestId}`);
    await expect(page.getByRole('heading', { name: /edit handout/i })).toBeVisible();
    await expect(page.getByText(/AI quality check/i)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /run quality check/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /generate with ai/i })).toHaveCount(0);

    await page.goto(`/faculty/assignments/${submitted.requestId}`);
    await expect(page.getByText(/Read-only while the subject expert reviews it/i)).toBeVisible();
    await expect(page.getByText(/AI quality check/i)).toHaveCount(0);
    await expect(page.getByText(/AI quality report/i)).toHaveCount(0);
  });

  test('admin has no AI Metrics tab or AI row, and the page is gone', async ({ page }) => {
    await signIn(page, 'admin@hmp.local');
    await page.goto('/admin');
    await expect(page.getByRole('link', { name: /^AI Metrics$/ })).toHaveCount(0);
    await expect(page.getByText(/AI provider/i)).toHaveCount(0);

    const res = await page.goto('/admin/ai-metrics');
    expect(res?.status()).toBe(404);
    await expect(page.getByTestId('not-found-page')).toBeVisible();
  });
});

test.describe('AI switched on (AI_FEATURES_ENABLED=true)', () => {
  test.skip(!AI_ON, 'runs only in the "e2e (AI on)" CI step');

  test('HOG sees the AI suggestions panel in heuristic-only mode', async ({ page }) => {
    const requestId = await icCreatesRequest(page);
    await signIn(page, 'hog@hmp.local');
    await page.goto(`/hog/requests/${requestId}`);
    await expect(page.getByText(/AI suggestions/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Heuristic-only|Rule-based match/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /regenerate/i })).toBeVisible();
  });

  test('Faculty quality panel surfaces a friendly error without AI keys', async ({ page }) => {
    const requestId = await icCreatesRequest(page);

    await signIn(page, 'hog@hmp.local');
    await page.goto(`/hog/requests/${requestId}`);
    await page
      .locator('label', { hasText: 'faculty@hmp.local' })
      .locator('input[type=checkbox]')
      .check();
    await page.getByTestId('sme-picker').selectOption({ index: 1 });
    await page.getByRole('button', { name: /allocate/i }).click();
    await expect(page.locator('[data-status="ALLOCATED"]').first()).toBeVisible({
      timeout: 10_000,
    });
    await signOut(page);

    await signIn(page, 'pc@hmp.local');
    await page.goto(`/pc/requests/${requestId}`);
    await page.getByRole('button', { name: /confirm allocation/i }).click();
    await expect(page.locator('[data-status="ASSIGNED"]').first()).toBeVisible({
      timeout: 10_000,
    });
    await signOut(page);

    await signIn(page, 'faculty@hmp.local');
    await page.goto(`/faculty/assignments/${requestId}`);
    await page.getByRole('button', { name: /accept assignment/i }).click();
    await page.getByRole('button', { name: /start editing/i }).click();
    await page.getByRole('button', { name: /run quality check/i }).click();
    await expect(
      page.getByText(/AI provider not configured|AI features aren.t available/i),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('Admin AI metrics page renders provider status + corpus controls', async ({ page }) => {
    await signIn(page, 'admin@hmp.local');
    await page.goto('/admin');
    await expect(page.getByRole('link', { name: /^AI Metrics$/ })).toBeVisible();
    await page.goto('/admin/ai-metrics');
    await expect(page.getByRole('heading', { name: /provider status/i })).toBeVisible();
    await expect(page.getByText(/Not configured/i).first()).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /embedding corpus|AI matching data/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /re-embed all|refresh AI matching data/i }),
    ).toBeVisible();
  });
});

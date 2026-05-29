import { test, expect, type Page } from '@playwright/test';

// Prompt 11d-a — Structured editor end-to-end.
//
// Covers the legacy → structured conversion + the round-trip of:
//   fill Part A → add a CO → fill 1 Part B session → save → reopen →
//   confirm persisted → switch to Preview tab → confirm rendered output.
//
// Same anti-flake discipline as m4-m9 specs: every assertion targets a
// persistent state element (badge, status text, version number) rather
// than a transient toast; no waitForTimeout; selectors are testid-first.

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

test('Faculty converts to structured editor, fills, saves, previews, persists across reload', async ({
  page,
}) => {
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

  // 2. HOG allocates the on-campus faculty.
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

  // 4. Faculty accepts, starts editing → lands on legacy editor with Convert banner.
  await signIn(page, 'faculty@hmp.local');
  await page.goto(`/faculty/assignments/${requestId}`);
  await page.getByRole('button', { name: /accept assignment/i }).click();
  await page.getByRole('button', { name: /start editing/i }).click();
  await expect(page.getByText(/IN_PROGRESS/i).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('bits-convert-banner')).toBeVisible({ timeout: 10_000 });

  // 5. Convert to structured editor.
  await page.getByTestId('bits-convert-button').click();
  await expect(page.getByTestId('bits-structured-editor')).toBeVisible({ timeout: 10_000 });
  // Pre-populated Part A: course title comes from the request context (the
  // seeded course's title, whatever it was — we don't assert the exact
  // string; just that the field is non-empty).
  const titleInput = page.getByTestId('bits-course-title');
  await expect(titleInput).toBeVisible();
  await expect(titleInput).not.toHaveValue('');

  // 6. Fill / edit the structured handout.
  await titleInput.fill('Automotive Diagnostics — E2E test');
  await page.getByTestId('bits-course-numbers').fill('AE ZG999, AEL ZG999');
  await page.getByTestId('bits-credit-model').fill('3-1-1');
  await page.getByTestId('bits-instructors').fill('Dr. E2E Faculty');
  await page.getByTestId('bits-date').fill('1 Jan 2026');

  // Adjust the seeded CO1 description.
  await page.getByTestId('bits-CO-text-0').fill('Understand the structured editor');
  // Add a second CO.
  await page.getByTestId('bits-CO-add').click();
  await page.getByTestId('bits-CO-text-1').fill('Demonstrate Part B session editing');

  // Adjust the seeded T1 citation.
  await page.getByTestId('bits-T-text-0').fill('E2E Reference, 1st ed.');
  // Adjust the seeded LO1 description.
  await page.getByTestId('bits-LO-text-0').fill('Save a structured handout');

  // Fill the single Part B session.
  await page.getByTestId('bits-partb-title-0').fill('Introduction to structured authoring');

  // 7. Save version.
  await page.getByTestId('bits-save-button').click();
  await expect(page.getByTestId('bits-editor-saved')).toContainText(/Saved v\d+/, {
    timeout: 15_000,
  });

  // 8. Switch to Preview tab — assert the rendered HTML carries the title and
  //    the CO codes we entered.
  await page.getByTestId('bits-tab-preview').click();
  const preview = page.getByTestId('bits-preview');
  await expect(preview).toContainText('Automotive Diagnostics — E2E test');
  await expect(preview).toContainText('CO1');
  await expect(preview).toContainText('CO2');
  await expect(preview).toContainText('Introduction to structured authoring');

  // 9. Reload — confirm state persisted to the DB. The structured editor
  //    appears (not the legacy + Convert banner combo), and the title we
  //    entered is restored from `HandoutVersion.data`.
  await page.reload();
  await expect(page.getByTestId('bits-structured-editor')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('bits-convert-banner')).toHaveCount(0);
  await expect(page.getByTestId('bits-course-title')).toHaveValue(
    'Automotive Diagnostics — E2E test',
  );
});

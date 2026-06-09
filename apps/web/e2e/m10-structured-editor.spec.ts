import { test, expect, type Page } from '@playwright/test';

// Prompt 11d — Structured editor end-to-end (extended in 11d-b, 11e).
//
// Comprehensive happy-path coverage:
//   - 11e auto-fetch: "Start editing" lands on the structured editor with the
//     AutoFetchBanner (tier=empty for this fresh-DB test path), dismiss
//     strips the search param so the banner doesn't reappear
//   - Part A: course title, COs, T-books, LOs
//   - Part B: sub-topics chip list (add 2, remove 1), references typeahead
//     (suggestions from Part A's T-codes)
//   - Experiential: enable section, edit overall objective
//   - Evaluation: live 100% validator — Save button DISABLED until weights
//     sum to 100 (the load-bearing 11d-b business rule per the watch-items)
//   - AI dialog: opens with stub draft (CI runs without AI keys)
//   - Save → Preview matches → reload → state persisted
//
// The legacy ConvertBanner path (data:null → click Convert → structured) is
// no longer exercised here — 11e routes new handouts directly to the
// structured editor, so the convert flow only fires for pre-11e legacy
// versions still in the database. Convert-flow regression coverage lives in
// the convertToStructuredAction unit tests.
//
// One long test rather than two. The IC→HOG→PC→Faculty setup is expensive
// (~30-45s); duplicating it across two tests would double runtime without
// adding coverage. Anti-flake discipline (no waitForTimeout, persistent-state
// assertions only, testid-first selectors) carried over from 11d-a.

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

test('Structured editor — full 11d-b/11e flow (auto-fetch banner → Part A → chips → eval 100% block → AI → preview → reload)', async ({
  page,
}) => {
  // -------- Setup: IC → HOG → PC → Faculty start editing → Convert --------
  await signIn(page, 'ic@hmp.local');
  await page.goto('/ic/requests/new');
  await page.getByLabel('Programme').selectOption({ index: 1 });
  await page.getByLabel('Semester').selectOption({ index: 1 });
  await page.getByLabel('Course').selectOption({ index: 1 });
  await page.getByRole('button', { name: /create request/i }).click();
  await page.waitForURL(/\/ic\/requests\/c[a-z0-9]{20,}/i);
  const requestId = page.url().split('/').pop()!;
  await signOut(page);

  await signIn(page, 'hog@hmp.local');
  await page.goto(`/hog/requests/${requestId}`);
  await page
    .locator('label', { hasText: 'faculty@hmp.local' })
    .locator('input[type=checkbox]')
    .check();
  // Prompt 12-b: SME is mandatory at allocation. Pick the first seeded SME.
  await page.getByTestId('sme-picker').selectOption({ index: 1 });
  await page.getByRole('button', { name: /allocate/i }).click();
  await expect(page.getByText(/ALLOCATED/i).first()).toBeVisible({ timeout: 10_000 });
  await signOut(page);

  await signIn(page, 'pc@hmp.local');
  await page.goto(`/pc/requests/${requestId}`);
  await page.getByRole('button', { name: /confirm assignment/i }).click();
  await expect(page.getByText(/ASSIGNED/i).first()).toBeVisible({ timeout: 10_000 });
  await signOut(page);

  await signIn(page, 'faculty@hmp.local');
  await page.goto(`/faculty/assignments/${requestId}`);
  await page.getByRole('button', { name: /accept assignment/i }).click();
  await page.getByRole('button', { name: /start editing/i }).click();
  await expect(page.getByText(/IN_PROGRESS/i).first()).toBeVisible({ timeout: 10_000 });
  // 11e auto-fetch: the redirect after startEditingAction adds
  // `?autoFetched=empty` to the URL; the banner renders above the structured
  // editor. In a fresh-DB test path there's no prior version for this course,
  // so the cascade falls through to Tier 3 (empty template).
  await expect(page.getByTestId('bits-structured-editor')).toBeVisible({ timeout: 10_000 });
  const banner = page.getByTestId('bits-autofetch-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toHaveAttribute('data-tier', 'empty');
  await expect(banner).toContainText(/Empty template/i);
  // Dismiss the banner → router.replace strips the search params → banner
  // doesn't reappear on subsequent renders (verified again after Save below).
  await page.getByTestId('bits-autofetch-dismiss').click();
  await expect(banner).toHaveCount(0);

  // -------- Part A scalars --------
  await page.getByTestId('bits-course-title').fill('Automotive Diagnostics — E2E test');
  await page.getByTestId('bits-course-numbers').fill('AE ZG999, AEL ZG999');
  await page.getByTestId('bits-credit-model').fill('3-1-1');
  await page.getByTestId('bits-instructors').fill('Dr. E2E Faculty');
  await page.getByTestId('bits-date').fill('1 Jan 2026');

  // -------- CO / T / LO repeats --------
  await page.getByTestId('bits-CO-text-0').fill('Understand the structured editor');
  await page.getByTestId('bits-CO-add').click();
  await page.getByTestId('bits-CO-text-1').fill('Demonstrate Part B session editing');

  await page.getByTestId('bits-T-text-0').fill('E2E Reference, 1st ed.');
  // Add a second T-book so the references chip-list has T1+T2 in its
  // suggestions pool (the 11d-b typeahead).
  await page.getByTestId('bits-T-add').click();
  await page.getByTestId('bits-T-text-1').fill('Secondary Reference, 1st ed.');

  await page.getByTestId('bits-LO-text-0').fill('Save a structured handout');

  // -------- Part B: title + chip-list sub-topics + references with typeahead --------
  await page.getByTestId('bits-partb-title-0').fill('Introduction to structured authoring');

  // Sub-topics: add 2 chips via Enter, then remove the first.
  const subInput = page.getByTestId('bits-partb-subtopics-0-input');
  await subInput.fill('Chips and pills');
  await subInput.press('Enter');
  await subInput.fill('Faculty workflow');
  await subInput.press('Enter');
  await expect(page.getByTestId('bits-partb-subtopics-0-chip-0')).toContainText('Chips and pills');
  await expect(page.getByTestId('bits-partb-subtopics-0-chip-1')).toContainText('Faculty workflow');
  // Remove the first chip — the second slides into index 0.
  await page.getByTestId('bits-partb-subtopics-0-chip-0').getByRole('button').click();
  await expect(page.getByTestId('bits-partb-subtopics-0-chip-0')).toContainText('Faculty workflow');

  // References: type "T1", commit, verify chip appears.
  const refInput = page.getByTestId('bits-partb-refs-0-input');
  await refInput.fill('T1');
  await refInput.press('Enter');
  await expect(page.getByTestId('bits-partb-refs-0-chip-0')).toContainText('T1');

  // Add a 2nd session via the Add button — verifies the repeater works.
  await page.getByTestId('bits-partb-add').click();
  await page.getByTestId('bits-partb-title-1').fill('Second contact session');

  // -------- Experiential: enable section, verify the toggle works --------
  await page.getByTestId('bits-experiential-toggle').click();
  // After toggling on, the toggle button text flips to "Remove section".
  await expect(page.getByTestId('bits-experiential-toggle')).toContainText('Remove section');

  // -------- Evaluation: the load-bearing 11d-b business rule --------
  //
  // Watch-item #2: "the 100% rule ACTUALLY blocks save." Verify the full
  // transition: empty (0%) → save disabled, add 60% → still disabled, add
  // 40% more → enabled.
  //
  // The blank-handout factory seeds evaluation.components = [], so total
  // weight is 0% on first open. Save must be disabled here.
  const saveBtn = page.getByTestId('bits-save-button');
  await expect(saveBtn).toBeDisabled();
  await expect(page.getByTestId('bits-eval-total')).toContainText(/must equal 100%/);

  // Add EC-1 with the seeded sub-component (weight 0) — total still 0%.
  await page.getByTestId('bits-eval-add-ec').click();
  await expect(saveBtn).toBeDisabled();

  // Set the sub-component weight to 60 → total 60% → still disabled.
  await page.getByTestId('bits-eval-weight-0-0').fill('60');
  await expect(page.getByTestId('bits-eval-total')).toContainText('60%');
  await expect(saveBtn).toBeDisabled();

  // Add EC-2 with one sub-component → set weight to 40 → total 100% → ENABLED.
  await page.getByTestId('bits-eval-add-ec').click();
  await page.getByTestId('bits-eval-name-1-0').fill('Final');
  await page.getByTestId('bits-eval-weight-1-0').fill('40');
  await expect(page.getByTestId('bits-eval-total')).toContainText('100%');
  await expect(page.getByTestId('bits-eval-total')).toContainText(/ready to save/);
  await expect(saveBtn).toBeEnabled();

  // Fill EC-1 sub-component name for completeness.
  await page.getByTestId('bits-eval-name-0-0').fill('Midterm');

  // -------- AI dialog: opens with stub draft (CI has no AI key) --------
  await page.getByTestId('bits-ai-open').click();
  const dialog = page.getByTestId('bits-ai-dialog');
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  // The stub source produces a clearly-labeled banner.
  await expect(dialog).toContainText(/template stub/i);
  // Close without applying (we don't want to clobber the form state we just filled).
  await dialog.getByRole('button', { name: /discard/i }).click();
  await expect(dialog).not.toBeVisible();

  // -------- Save the structured version --------
  await page.getByTestId('bits-save-button').click();
  await expect(page.getByTestId('bits-editor-saved')).toContainText(/Saved v\d+/, {
    timeout: 15_000,
  });

  // -------- Preview tab: rendered HTML carries everything --------
  await page.getByTestId('bits-tab-preview').click();
  const preview = page.getByTestId('bits-preview');
  await expect(preview).toContainText('Automotive Diagnostics — E2E test');
  await expect(preview).toContainText('CO1');
  await expect(preview).toContainText('CO2');
  await expect(preview).toContainText('Introduction to structured authoring');
  await expect(preview).toContainText('Second contact session');
  // The renderer shows the EC numbers from Part C (Evaluation Scheme).
  await expect(preview).toContainText('EC-1');
  await expect(preview).toContainText('EC-2');

  // -------- Reload: state persisted via HandoutVersion.data --------
  await page.reload();
  await expect(page.getByTestId('bits-structured-editor')).toBeVisible({ timeout: 10_000 });
  // 11e: banner is gone after dismissal AND remains gone on reload (URL
  // search params were stripped by router.replace).
  await expect(page.getByTestId('bits-autofetch-banner')).toHaveCount(0);
  await expect(page.getByTestId('bits-convert-banner')).toHaveCount(0);
  await expect(page.getByTestId('bits-course-title')).toHaveValue(
    'Automotive Diagnostics — E2E test',
  );
  await expect(page.getByTestId('bits-eval-total')).toContainText('100%');
});

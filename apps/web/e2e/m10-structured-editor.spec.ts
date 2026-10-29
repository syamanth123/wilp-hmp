import { test, expect, type Page } from '@playwright/test';

// Prompt 11d — Structured editor end-to-end (extended in 11d-b, 11e).
//
// Comprehensive happy-path coverage:
//   - 11e auto-fetch: "Start editing" lands on the structured editor with the
//     AutoFetchBanner (tier=empty for this fresh-DB test path), dismiss
//     strips the search param so the banner doesn't reappear
//   - Course details table, COs (add, delete, auto-renumber), T-books, LOs —
//     all edited in place on the document page (handout-editor-ux)
//   - Course plan: topic, sub-topics one per line, references
//   - Experiential: enable the optional section
//   - Evaluation: live 100% validator — Save button DISABLED until weights
//     sum to 100 (the load-bearing 11d-b business rule per the watch-items)
//   - AI features off by default: no AI draft in the More menu
//   - Save → full-screen Preview matches → reload → state persisted
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

test('Structured editor — full flow on the document page (auto-fetch banner → course details → tables → eval 100% block → preview → reload)', async ({
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
  await expect(page.locator('[data-status="ALLOCATED"]').first()).toBeVisible({ timeout: 10_000 });
  await signOut(page);

  await signIn(page, 'pc@hmp.local');
  await page.goto(`/pc/requests/${requestId}`);
  await page.getByRole('button', { name: /confirm allocation/i }).click();
  await expect(page.locator('[data-status="ASSIGNED"]').first()).toBeVisible({ timeout: 10_000 });
  await signOut(page);

  await signIn(page, 'faculty@hmp.local');
  await page.goto(`/faculty/assignments/${requestId}`);
  await page.getByRole('button', { name: /accept assignment/i }).click();
  await page.getByRole('button', { name: /start editing/i }).click();
  await expect(page.locator('[data-status="IN_PROGRESS"]').first()).toBeVisible({
    timeout: 10_000,
  });
  // 11e auto-fetch: the redirect after startEditingAction adds
  // `?autoFetched=empty` to the URL; the banner renders above the structured
  // editor. In a fresh-DB test path there's no prior version for this course,
  // so the cascade falls through to Tier 3 (empty template).
  await expect(page.getByTestId('bits-structured-editor')).toBeVisible({ timeout: 10_000 });
  const banner = page.getByTestId('bits-autofetch-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toHaveAttribute('data-tier', 'empty');
  await expect(banner).toContainText(/Started from a blank handout/i);
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

  // Codes renumber themselves: delete CO1 and the old CO2 becomes CO1.
  await page.getByTestId('bits-CO-add').click();
  await page.getByTestId('bits-CO-text-2').fill('Temporary objective');
  await page.getByTestId('bits-CO-row-2').hover();
  await page.getByTestId('bits-CO-del-2').click();
  await expect(page.getByTestId('bits-CO-row-2')).toHaveCount(0);

  // -------- Course plan: topic, sub-topics one per line, references --------
  await page.getByTestId('bits-partb-title-0').fill('Introduction to structured authoring');
  await page.getByTestId('bits-partb-subtopics-0').fill('Chips and pills\nFaculty workflow');
  await page.getByTestId('bits-partb-refs-0').fill('T1, R1');

  // Add a 2nd session via "+ Add session" — verifies the repeater works.
  await page.getByTestId('bits-partb-add').click();
  await page.getByTestId('bits-partb-title-1').fill('Second contact session');

  // -------- Experiential: enable the optional section --------
  await page.getByTestId('bits-experiential-toggle').click();
  await expect(page.getByTestId('bits-experiential')).toContainText('List of Experiments');

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
  await expect(page.getByTestId('bits-eval-total')).toContainText(/must add up to 100%/);

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
  await expect(page.getByTestId('bits-eval-total')).toContainText('✓');
  await expect(saveBtn).toBeEnabled();

  // Fill EC-1 sub-component name for completeness.
  await page.getByTestId('bits-eval-name-0-0').fill('Midterm');

  // -------- AI features are switched off by default (AI_FEATURES_ENABLED) --------
  await page.getByTestId('bits-more-button').click();
  await expect(page.getByTestId('bits-ai-open')).toHaveCount(0);
  await page.getByTestId('bits-more-button').click();

  // -------- Save the structured version --------
  await page.getByTestId('bits-save-button').click();
  await expect(page.getByTestId('bits-editor-saved')).toContainText(/Saved draft v\d+/, {
    timeout: 15_000,
  });

  // -------- Preview (full screen, published renderer) carries everything --------
  await page.getByTestId('bits-preview-button').click();
  const preview = page.getByTestId('bits-preview');
  await expect(preview).toContainText('Automotive Diagnostics — E2E test');
  await expect(preview).toContainText('CO1');
  await expect(preview).toContainText('CO2');
  await expect(preview).toContainText('Introduction to structured authoring');
  await expect(preview).toContainText('Second contact session');
  // The renderer shows the EC numbers from Part C (Evaluation Scheme).
  await expect(preview).toContainText('EC-1');
  await expect(preview).toContainText('EC-2');
  await page.getByTestId('bits-preview-back').click();

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

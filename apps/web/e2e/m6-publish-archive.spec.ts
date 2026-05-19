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

test('IC publishes an approved handout and archives it', async ({ page }) => {
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

  // 4. Faculty accepts, edits, submits.
  await signIn(page, 'faculty@hmp.local');
  await page.goto(`/faculty/assignments/${requestId}`);
  await page.getByRole('button', { name: /accept assignment/i }).click();
  await page.getByRole('button', { name: /start editing/i }).click();
  const editor = page.locator('.ProseMirror').first();
  await editor.click();
  await editor.type(' — final draft');
  await page.getByRole('button', { name: /submit for review/i }).click();
  // Editor-panel's transient success message is replaced by the read-only
  // viewer once revalidatePath re-fetches. Assert on the persistent status
  // badge instead.
  await expect(page.getByText(/^Submitted$/).first()).toBeVisible({ timeout: 15_000 });
  await signOut(page);

  // 5. PC approves.
  await signIn(page, 'pc@hmp.local');
  await page.goto(`/pc/requests/${requestId}`);
  await page.getByRole('button', { name: /approve & forward/i }).click();
  await expect(page.getByText(/UNDER_REVIEW/i).first()).toBeVisible({ timeout: 10_000 });
  await signOut(page);

  // 6. HOG final-approves.
  await signIn(page, 'hog@hmp.local');
  await page.goto(`/hog/requests/${requestId}`);
  await page.getByRole('button', { name: /approve \(final\)/i }).click();
  await expect(page.getByText(/APPROVED/i).first()).toBeVisible({ timeout: 10_000 });
  await signOut(page);

  // 7. IC publishes.
  await signIn(page, 'ic@hmp.local');
  await page.goto(`/ic/requests/${requestId}`);
  await page.getByRole('button', { name: /publish to lms/i }).click();
  // The publish action's transient "Published to LMS…" success message gets
  // replaced by the revalidate-driven re-render (which switches the page to
  // PUBLISHED state and renders the Archive panel) before Playwright can
  // observe it. Assert on the persistent status badge instead — it appears
  // either via the success message ("Published to LMS…") or the re-rendered
  // page's badge ("Published"), and both confirm the action committed.
  await expect(page.getByText(/Published/i).first()).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await expect(page.getByText(/PUBLISHED/i).first()).toBeVisible();
  await expect(page.getByText(/taxila-stub/i)).toBeVisible();

  // 8. IC archives.
  await page.getByLabel(/I understand this moves the handout to ARCHIVED/i).check();
  await page.getByRole('button', { name: /archive this handout/i }).click();
  // Same pattern: "Archived." is transient; reload + check the persistent
  // ARCHIVED badge.
  await expect(page.getByText(/Archived/i).first()).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await expect(page.getByText(/ARCHIVED/i).first()).toBeVisible();
});

test('Faculty and PC can exchange comments on a request', async ({ page }) => {
  // Quickly set up a request to ASSIGNED so a handout exists.
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
  await page.getByRole('button', { name: /allocate/i }).click();
  await expect(page.getByText(/ALLOCATED/i).first()).toBeVisible({ timeout: 10_000 });
  await signOut(page);

  await signIn(page, 'pc@hmp.local');
  await page.goto(`/pc/requests/${requestId}`);
  await page.getByRole('button', { name: /confirm assignment/i }).click();
  await expect(page.getByText(/ASSIGNED/i).first()).toBeVisible({ timeout: 10_000 });

  // PC posts a comment. The textarea text alone would match `getByText` even
  // if the post action raced — assert the textarea CLEARS (the real success
  // signal) so we know the server action committed before we navigate away.
  await page.getByLabel('Add a comment').fill('Please double-check Bloom alignment.');
  await page.getByRole('button', { name: /post comment/i }).click();
  await expect(page.getByLabel('Add a comment')).toHaveValue('', { timeout: 15_000 });
  await expect(
    page.locator('li', { hasText: 'Please double-check Bloom alignment.' }),
  ).toBeVisible({ timeout: 10_000 });
  await signOut(page);

  // Faculty sees PC's comment and replies.
  await signIn(page, 'faculty@hmp.local');
  await page.goto(`/faculty/assignments/${requestId}`);
  await expect(
    page.locator('li', { hasText: 'Please double-check Bloom alignment.' }),
  ).toBeVisible({ timeout: 15_000 });
  await page.getByLabel('Add a comment').fill('Updated Bloom levels for objectives 2 and 3.');
  await page.getByRole('button', { name: /post comment/i }).click();
  await expect(page.getByLabel('Add a comment')).toHaveValue('', { timeout: 15_000 });
  await expect(
    page.locator('li', { hasText: 'Updated Bloom levels' }),
  ).toBeVisible({ timeout: 10_000 });
});

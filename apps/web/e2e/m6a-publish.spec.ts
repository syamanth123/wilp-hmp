import { test, expect, type Page } from '@playwright/test';
import { seedHandoutAtStatus, cleanupTestHandouts } from './fixtures/handout';

// ─── REQUIRES MINIO ──────────────────────────────────────────────────────────
// Prompt 9b changed publish to the real two-mode Taxila engine. With no
// TAXILA_API_URL (the default), publishing runs Mode B: it exports a ZIP to
// object storage (MinIO) and the request stays APPROVED until the IC confirms a
// manual upload. This spec therefore needs MinIO. It SKIPS locally without
// Docker and RUNS in CI, which provides MinIO via a `docker run` step (see
// .github/workflows/ci.yml). The skip is gated on a MinIO reachability probe.
// ─────────────────────────────────────────────────────────────────────────────

const MINIO_HEALTH = `${process.env.S3_ENDPOINT ?? 'http://localhost:9000'}/minio/health/live`;

async function minioReachable(): Promise<boolean> {
  try {
    const res = await fetch(MINIO_HEALTH, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

test.describe('IC publish (Mode B — export + manual confirm)', () => {
  let requestId: string;
  let skip = false;

  test.beforeEach(async () => {
    skip = !(await minioReachable());
    test.skip(skip, 'MinIO not reachable — Mode B export requires object storage (CI only)');
    const { requestId: id } = await seedHandoutAtStatus({ status: 'APPROVED' });
    requestId = id;
  });

  test.afterEach(async () => {
    if (!skip) await cleanupTestHandouts();
  });

  test('IC exports an approved handout, then confirms manual publication', async ({ page }) => {
    await signIn(page, 'ic@hmp.local');
    await page.goto(`/ic/requests/${requestId}`);

    await expect(page.getByText(/^Approved$/).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Publish to LMS' })).toBeVisible();

    // Step 1 — publish → Mode B export. Request stays APPROVED.
    await page.getByRole('button', { name: /publish to lms/i }).click();

    // Persistent post-export signal: the action-required callout with a
    // download link + the "Mark as manually published" button.
    await expect(page.getByText(/Action required: finish publishing/i)).toBeVisible({
      timeout: 30_000,
    });
    const downloadLink = page.getByRole('link', { name: /download the export package/i });
    await expect(downloadLink).toBeVisible();
    // Status is still APPROVED (NOT auto-published).
    await expect(page.getByText(/^Approved$/).first()).toBeVisible();

    // Step 2 — the presigned link resolves against MinIO (HEAD → 200).
    const href = await downloadLink.getAttribute('href');
    expect(href).toBeTruthy();
    const head = await page.request.get(href!);
    expect(head.status()).toBe(200);

    // Step 3 — confirm manual publication → workflow advances to PUBLISHED.
    await page.getByRole('button', { name: /mark as manually published/i }).click();

    // Persistent post-action signal: the Archive card appears (gated on
    // status === PUBLISHED server-side).
    await expect(page.getByRole('heading', { name: 'Archive', exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(/^Published$/).first()).toBeVisible();
  });
});

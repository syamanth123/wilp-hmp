import { test, expect, type Page } from '@playwright/test';
import { seedHandoutAtStatus, cleanupTestHandouts } from './fixtures/handout';

// ─── REQUIRES MINIO ──────────────────────────────────────────────────────────
// Prompt 16: handout file attachments via S3. Exercises the full loop against an
// IN_PROGRESS handout: the assigned faculty uploads a file (Route Handler →
// MinIO), sees it listed with a download link, and deletes it; then a PC sees
// the same attachment read-only (download link, no delete control). Needs MinIO
// for the object round-trip. SKIPS locally without Docker; RUNS in CI which
// provides it. See .github/workflows/ci.yml.
// ─────────────────────────────────────────────────────────────────────────────

const S3_ENDPOINT = process.env.S3_ENDPOINT ?? 'http://localhost:9000';

async function minioReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${S3_ENDPOINT}/minio/health/live`, {
      signal: AbortSignal.timeout(3000),
    });
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

const SAMPLE_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF',
  'utf8',
);

test.describe('Handout attachments (S3)', () => {
  let requestId: string;
  let skip = false;

  test.beforeEach(async () => {
    skip = !(await minioReachable());
    test.skip(skip, 'MinIO not reachable — attachments require object storage (CI only)');
    ({ requestId } = await seedHandoutAtStatus({ status: 'IN_PROGRESS' }));
  });

  test.afterEach(async () => {
    if (!skip) await cleanupTestHandouts();
  });

  test('assigned faculty can upload, see, download, and delete an attachment', async ({ page }) => {
    await signIn(page, 'faculty@hmp.local');
    await page.goto(`/faculty/assignments/${requestId}`);

    // Starts empty.
    await expect(page.getByTestId('attachments-empty')).toBeVisible();

    // Upload a PDF via the panel's file input.
    await page.getByTestId('attachment-file-input').setInputFiles({
      name: 'exam-paper.pdf',
      mimeType: 'application/pdf',
      buffer: SAMPLE_PDF,
    });

    // It appears in the list with a working download link.
    const list = page.getByTestId('attachments-list');
    await expect(list).toBeVisible();
    const link = list.getByRole('link', { name: 'exam-paper.pdf' });
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    expect(href).toBeTruthy();
    const dl = await page.request.get(href!);
    expect(dl.ok()).toBeTruthy();

    // Delete it (the uploader sees a Delete control while editable).
    await page.locator('[data-testid^="attachment-delete-"]').first().click();
    await expect(page.getByTestId('attachments-empty')).toBeVisible();
  });

  test('a PC sees the attachment read-only — download link, no delete control', async ({
    page,
    browser,
  }) => {
    // Faculty uploads first.
    await signIn(page, 'faculty@hmp.local');
    await page.goto(`/faculty/assignments/${requestId}`);
    await page.getByTestId('attachment-file-input').setInputFiles({
      name: 'reference.pdf',
      mimeType: 'application/pdf',
      buffer: SAMPLE_PDF,
    });
    await expect(page.getByTestId('attachments-list')).toBeVisible();

    // A separate PC session views the same request.
    const pcContext = await browser.newContext();
    const pcPage = await pcContext.newPage();
    try {
      await signIn(pcPage, 'pc@hmp.local');
      await pcPage.goto(`/pc/requests/${requestId}`);
      const list = pcPage.getByTestId('attachments-list');
      await expect(list).toBeVisible();
      await expect(list.getByRole('link', { name: 'reference.pdf' })).toBeVisible();
      // Read-only: no upload input, no delete control.
      await expect(pcPage.getByTestId('attachment-file-input')).toHaveCount(0);
      await expect(pcPage.locator('[data-testid^="attachment-delete-"]')).toHaveCount(0);
    } finally {
      await pcContext.close();
    }
  });
});

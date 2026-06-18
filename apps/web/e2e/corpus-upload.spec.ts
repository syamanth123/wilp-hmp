import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prisma } from '@hmp/db';

// Prompt 24 — admin manual handout upload. Uploads a synthetic .docx fixture
// under a sentinel original-name so the resulting HandoutImport row is safe to
// delete in afterEach. Word import works anywhere; .doc conversion needs
// LibreOffice (not exercised here — covered by db unit tests + probe-skips).

const FIXTURE = join(
  __dirname,
  '..',
  '..',
  '..',
  'packages',
  'db',
  'src',
  '__fixtures__',
  'corpus-samples',
  'f1-standard.docx',
);
const SENTINEL = 'E2E-UPLOAD-TEST.docx';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

test.describe('Admin corpus upload', () => {
  test.afterEach(async () => {
    await prisma.handoutImport
      .deleteMany({ where: { sourceFile: SENTINEL } })
      .catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
  });

  test('admin uploads a .docx → imported row appears with a result state', async ({ page }) => {
    await signIn(page, 'admin@hmp.local');
    await page.goto('/admin/corpus-imports');
    await expect(page.getByTestId('upload-handout-form')).toBeVisible();

    await page.getByTestId('upload-file-input').setInputFiles({
      name: SENTINEL,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: readFileSync(FIXTURE),
    });
    await page.getByTestId('upload-submit').click();

    const result = page.getByTestId('upload-result');
    await expect(result).toBeVisible({ timeout: 15_000 });
    // f1-standard parses cleanly → 'clean'; tolerate 'warnings' (placeholder fields).
    await expect(result).toHaveAttribute('data-state', /clean|warnings/);

    // The row exists in the DB (unapproved), keyed on the sentinel original name.
    const row = await prisma.handoutImport.findUnique({ where: { sourceFile: SENTINEL } });
    expect(row).not.toBeNull();
    expect(row?.approvedForReuse).toBe(false);
  });

  test('rejects a non-Word file with a format error (415 → error state)', async ({ page }) => {
    await signIn(page, 'admin@hmp.local');
    await page.goto('/admin/corpus-imports');

    await page.getByTestId('upload-file-input').setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('not a handout'),
    });
    await page.getByTestId('upload-submit').click();

    const result = page.getByTestId('upload-result');
    await expect(result).toBeVisible({ timeout: 10_000 });
    await expect(result).toHaveAttribute('data-state', 'error');
    await expect(result).toContainText(/unsupported_format/i);
  });
});

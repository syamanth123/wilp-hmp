import { test, expect, type Page } from '@playwright/test';
import { PrismaClient } from '@hmp/db';
import { seedHandoutAtStatus, cleanupTestHandouts } from './fixtures/handout';
import { blankHandoutForRequest } from '../src/app/faculty/assignments/[id]/structured-editor/state';

// Handout editor UX (docs/plans/handout-editor-ux.md): the page IS the handout
// and is edited in place. One round trip proves the whole loop: change a course
// objective directly on the page → the full-screen Preview (the unchanged
// renderer) shows it → Save draft → reload keeps it.
//
// Seeding: the shared fixture creates an IN_PROGRESS handout with a legacy
// version; the test gives that version a structured body (the blank-handout
// factory + a 100% evaluation scheme) so it opens straight in the editor.

const prisma = new PrismaClient();
const OBJECTIVE = `Analyse real datasets with the methods taught — e2e ${Date.now()}`;

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

test.describe('Handout editor — edit on the page, preview, save, reload', () => {
  let requestId: string;

  test.beforeEach(async () => {
    ({ requestId } = await seedHandoutAtStatus({ status: 'IN_PROGRESS' }));
    const blank = blankHandoutForRequest({
      courseTitle: 'Inline Editing E2E',
      courseNumbers: ['ZZ ZG999'],
      semesterName: 'Sem-I 2026-27',
      instructorName: 'On-Campus Faculty',
    });
    const data = {
      ...blank,
      evaluation: {
        ...blank.evaluation,
        components: [
          {
            ecNumber: 'EC-1',
            subComponents: [
              { name: 'Comprehensive', type: 'Closed book', weight: 100, duration: '3 hours' },
            ],
          },
        ],
      },
    };
    const handout = await prisma.handout.findUniqueOrThrow({
      where: { requestId },
      select: { currentVersionId: true },
    });
    await prisma.handoutVersion.update({
      where: { id: handout.currentVersionId! },
      data: { data },
    });
  });

  test.afterEach(async () => {
    await cleanupTestHandouts();
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test('a course objective typed on the page shows in Preview and survives Save + reload', async ({
    page,
  }) => {
    await signIn(page, 'faculty@hmp.local');
    await page.goto(`/faculty/assignments/${requestId}`);
    await expect(page.getByTestId('bits-document-page')).toBeVisible({ timeout: 20_000 });

    // The empty objective shows its grey prompt; typing marks the page unsaved.
    const co1 = page.getByTestId('bits-CO-text-0');
    await expect(co1).toHaveAttribute('placeholder', /Click to add course objective/);
    await co1.click();
    await co1.fill(OBJECTIVE);
    await expect(page.getByTestId('bits-unsaved-dot')).toBeVisible();

    // Preview: full-screen, drawn by the published renderer.
    await page.getByTestId('bits-preview-button').click();
    const preview = page.getByTestId('bits-preview');
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('Scope and Objectives');
    await expect(preview).toContainText(OBJECTIVE);
    await page.getByTestId('bits-preview-back').click();
    await expect(preview).toHaveCount(0);

    // Save, then reload: the objective is still on the page.
    await page.getByTestId('bits-save-button').click();
    await expect(page.getByTestId('bits-editor-saved')).toContainText(/Saved draft v\d+/, {
      timeout: 15_000,
    });
    await page.reload();
    await expect(page.getByTestId('bits-CO-text-0')).toHaveValue(OBJECTIVE, { timeout: 20_000 });
  });
});

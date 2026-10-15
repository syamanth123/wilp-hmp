import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@hmp/db';

// Course Dibba Phase 3 — IC creates a term, uploads the committed 2025 .docx
// fixture (no LibreOffice needed in CI), reviews the preview and publishes.
// Phase 4 adds the term-setup flow (edit, class time, exam date, faculty CSV,
// manual instructor) as a third test; CourseInstructor and SlotExamDate rows
// cascade from the term delete below.
//
// Cleanup-by-fixture convention (audit §1): the term is created through the
// UI under a per-run sentinel name AND a per-run year — AcademicTerm is unique
// on (year, term) since Phase 3 and the e2e DB already holds (2025, FIRST)
// from the seed — and everything under it is deleted in afterEach inside
// try/finally (imports first: DibbaImport.termId is onDelete: Restrict).

const prisma = new PrismaClient();
const FIXTURE = join(
  __dirname,
  '..',
  '..',
  '..',
  'packages',
  'db',
  'src',
  '__fixtures__',
  'dibba',
  'course-dibba-2025-s1.docx',
);
const TS = Date.now();
const TERM_NAME = `E2E-DIBBA-${process.pid}-${TS}`;
// The create-term form and action bound the year to 2000–2100 (a sensible guard
// on a hand-typed year), and (year, term) is the unique key: vary both so
// parallel workers and stale rows cannot collide, and stay clear of the seeded
// (2025, FIRST).
const YEAR = 2026 + (TS % 75);
const TERM_KIND = (['FIRST', 'SECOND', 'SUMMER'] as const)[process.pid % 3]!;

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

test.describe('IC Course Dibba — upload → preview → publish', () => {
  test.afterEach(async () => {
    try {
      const term = await prisma.academicTerm.findUnique({
        where: { name: TERM_NAME },
        select: { id: true },
      });
      if (term) {
        await prisma.dibbaImport.deleteMany({ where: { termId: term.id } }); // entries cascade
        await prisma.academicTerm.delete({ where: { id: term.id } }); // slots cascade
      }
    } catch (err) {
      console.error('[ic-dibba e2e] cleanup failed', err);
    } finally {
      await prisma.$disconnect().catch(() => undefined);
    }
  });

  test('IC creates a term, uploads the 2025 Dibba, sees 1,077 rows + 5 warnings, publishes', async ({
    page,
  }) => {
    await signIn(page, 'ic@hmp.local');
    await page.goto('/ic/dibba');

    // 1. Create the term (seeds its 8 standard slots).
    await expect(page.getByTestId('dibba-create-term-form')).toBeVisible();
    await page.locator('#term-name').fill(TERM_NAME);
    await page.locator('#term-year').fill(String(YEAR));
    await page.locator('#term-term').selectOption(TERM_KIND);
    await page.locator('#term-start').fill(`${YEAR}-08-01`);
    await page.locator('#term-end').fill(`${YEAR}-12-15`);
    await page.getByTestId('dibba-create-term-submit').click();
    await expect(page.getByTestId('dibba-create-term-done')).toBeVisible({ timeout: 15_000 });

    // 2. Upload the committed .docx for that term → redirected to the preview.
    //    The select must already hold a real term after the in-place refresh
    //    (guards the stale-state regression), then pick ours explicitly.
    await expect(page.getByTestId('dibba-term-select')).toHaveValue(/.+/);
    await page.getByTestId('dibba-term-select').selectOption({ label: TERM_NAME });
    await page.getByTestId('dibba-file-input').setInputFiles({
      name: 'course-dibba-2025-s1.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: readFileSync(FIXTURE),
    });
    await page.getByTestId('dibba-upload-submit').click();
    await page.waitForURL(/\/ic\/dibba\/[a-z0-9]+$/, { timeout: 60_000 });

    // 3. Preview: the frozen golden numbers and the two warning families.
    await expect(page.getByTestId('dibba-stat-rows')).toContainText('1,077');
    await expect(page.getByTestId('dibba-stat-codes')).toContainText('638');
    await expect(page.getByTestId('dibba-stat-programmes')).toContainText('41');
    await expect(page.getByTestId('dibba-warnings-header').locator('li')).toHaveCount(3);
    await expect(page.getByTestId('dibba-warnings-merged-cell').locator('li')).toHaveCount(2);
    await expect(page.getByTestId('dibba-preview-status')).toHaveText('Draft');

    // 4. Publish: the acknowledgement gates the button; after publish the page
    //    re-renders with the PUBLISHED state.
    const publishButton = page.getByTestId('dibba-publish-button');
    await expect(publishButton).toBeDisabled();
    await page.getByTestId('dibba-publish-confirm').check();
    await publishButton.click();
    await expect(page.getByTestId('dibba-preview-status')).toHaveText('Published', {
      timeout: 30_000,
    });
    await expect(page.getByTestId('dibba-status-line')).toContainText(/published schedule/i);

    // 5. DB truth: exactly one PUBLISHED import for the sentinel term, 1,077 rows.
    const term = await prisma.academicTerm.findUniqueOrThrow({
      where: { name: TERM_NAME },
      select: { id: true },
    });
    const published = await prisma.dibbaImport.findMany({
      where: { termId: term.id, status: 'PUBLISHED' },
      select: { rowCount: true, publishedAt: true },
    });
    expect(published).toHaveLength(1);
    expect(published[0]!.rowCount).toBe(1077);
    expect(published[0]!.publishedAt).not.toBeNull();
    expect(await prisma.slotTiming.count({ where: { termId: term.id } })).toBe(8);
  });

  test('a non-Dibba file is rejected before anything is written (415 → error state)', async ({
    page,
  }) => {
    await signIn(page, 'ic@hmp.local');
    await page.goto('/ic/dibba');
    await page.getByTestId('dibba-file-input').setInputFiles({
      name: 'notes.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('not a dibba'),
    });
    await page.getByTestId('dibba-upload-submit').click();
    const result = page.getByTestId('dibba-upload-result');
    await expect(result).toBeVisible({ timeout: 10_000 });
    await expect(result).toHaveAttribute('data-state', 'error');
  });

  test('Phase 4: IC edits the term, sets a class time + exam date, imports a faculty CSV, adds and removes an instructor', async ({
    page,
  }) => {
    await signIn(page, 'ic@hmp.local');
    await page.goto('/ic/dibba');

    // 1. Create the term through the UI (seeds the 8 slots), then open its page.
    await page.locator('#term-name').fill(TERM_NAME);
    await page.locator('#term-year').fill(String(YEAR));
    await page.locator('#term-term').selectOption(TERM_KIND);
    await page.locator('#term-start').fill(`${YEAR}-08-01`);
    await page.locator('#term-end').fill(`${YEAR}-12-15`);
    await page.getByTestId('dibba-create-term-submit').click();
    await expect(page.getByTestId('dibba-create-term-done')).toBeVisible({ timeout: 15_000 });
    const term = await prisma.academicTerm.findUniqueOrThrow({
      where: { name: TERM_NAME },
      select: { id: true },
    });
    await page.goto(`/ic/dibba/terms/${term.id}`);
    await expect(page.getByTestId('dibba-term-title')).toHaveText(TERM_NAME);

    // 2. Edit: move the end date; the page re-renders with the new value.
    await page.locator('#edit-term-end').fill(`${YEAR}-12-20`);
    await page.getByTestId('dibba-term-edit-submit').click();
    await expect(page.getByTestId('dibba-term-edit-done')).toBeVisible({ timeout: 15_000 });
    const edited = await prisma.academicTerm.findUniqueOrThrow({
      where: { id: term.id },
      select: { endDate: true },
    });
    expect(edited.endDate.getDate()).toBe(20);

    // 3. Slots: a class time for slot 1 and a mid-semester exam date for slot 1.
    await page.goto(`/ic/dibba/terms/${term.id}/slots`);
    await page.locator('#slot-1-start').fill('09:00');
    await page.locator('#slot-1-end').fill('12:00');
    await page.getByTestId('dibba-slot-timings-submit').click();
    await expect(page.getByTestId('dibba-slot-timings-done')).toContainText('slot 1', {
      timeout: 15_000,
    });
    await page.locator('#exam-1-mid-date').fill(`${YEAR}-10-05`);
    await page.locator('#exam-1-mid-start').fill('10:00');
    await page.locator('#exam-1-mid-end').fill('12:00');
    await page.getByTestId('dibba-exam-dates-submit').click();
    await expect(page.getByTestId('dibba-exam-dates-done')).toContainText('1 exam date', {
      timeout: 15_000,
    });
    const slot1 = await prisma.slotTiming.findUniqueOrThrow({
      where: { termId_slotNo: { termId: term.id, slotNo: 1 } },
    });
    expect(slot1).toMatchObject({ startTime: '09:00', endTime: '12:00' });
    expect(await prisma.slotExamDate.count({ where: { termId: term.id } })).toBe(1);

    // 4. Instructors: a two-row CSV — one seeded account, one unknown email.
    await page.goto(`/ic/dibba/terms/${term.id}/instructors`);
    await page.getByTestId('dibba-faculty-file-input').setInputFiles({
      name: 'faculty.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'FACULTY NAME,Email,Course Number,dabba\n' +
          'Seeded Faculty (LEAD),faculty@hmp.local,CS ZG501,1\n' +
          'Nobody Here,nobody.e2e@hmp.local,CS ZG501,1\n',
      ),
    });
    await page.getByTestId('dibba-faculty-upload-submit').click();
    const result = page.getByTestId('dibba-faculty-upload-result');
    await expect(result).toBeVisible({ timeout: 30_000 });
    await expect(result).toHaveAttribute('data-state', 'ok');
    await expect(page.getByTestId('dibba-faculty-unmatched').locator('li')).toHaveCount(1);
    await expect(page.getByTestId('dibba-instructor-group-CS-ZG501')).toContainText(
      'faculty@hmp.local',
    );

    // 5. Manual add for another code, then remove it (confirm dialog accepted).
    await page.locator('#instructor-code').fill('SS ZG527');
    await page.locator('#instructor-email').fill('faculty@hmp.local');
    await page.getByTestId('dibba-instructor-add-submit').click();
    await expect(page.getByTestId('dibba-instructor-add-done')).toContainText('SS ZG527', {
      timeout: 15_000,
    });
    const manual = await prisma.courseInstructor.findFirstOrThrow({
      where: { termId: term.id, courseCode: 'SS ZG527' },
      select: { id: true, source: true },
    });
    expect(manual.source).toBe('MANUAL');
    await expect(page.getByTestId(`dibba-instructor-row-${manual.id}`)).toBeVisible();
    page.once('dialog', (d) => d.accept());
    await page.getByTestId(`dibba-instructor-remove-${manual.id}`).click();
    await expect(page.getByTestId(`dibba-instructor-row-${manual.id}`)).toHaveCount(0, {
      timeout: 15_000,
    });

    // 6. DB truth: the sheet row survives, the manual row is gone, nobody was created.
    const rows = await prisma.courseInstructor.findMany({ where: { termId: term.id } });
    expect(rows.map((r) => [r.courseCode, r.source, r.isLead])).toEqual([
      ['CS ZG501', 'DIBBA_SHEET', true],
    ]);
    expect(await prisma.user.count({ where: { email: 'nobody.e2e@hmp.local' } })).toBe(0);
  });
});

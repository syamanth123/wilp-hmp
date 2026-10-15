import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient, STANDARD_SLOTS } from '@hmp/db';

// Course Dibba Phases 5–6 — the published Dibba reaches the right people:
// IC publishes the committed 2025 fixture for a term that contains today and
// adds faculty@hmp.local to one of its courses; that faculty sees the course
// on /faculty/schedule (grid cell + card) and the dashboard's next-events card;
// faculty2@hmp.local, who teaches nothing in it, sees the empty state; HOG sees
// the term overview with the course under the faculty filter.
//
// Cleanup-by-fixture (audit §1): sentinel term name + per-run year, deleted in
// afterEach (imports first; instructors/slots/exam dates cascade from the term).

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
const TERM_NAME = `E2E-SCHED-${process.pid}-${TS}`;
const YEAR = 2026 + ((TS + 17) % 75);
const TERM_KIND = (['FIRST', 'SECOND', 'SUMMER'] as const)[(process.pid + 1) % 3]!;

const isoLocal = (d: Date): string => {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
};
const shift = (days: number): Date => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
};

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

test.describe('Course Dibba — faculty My Schedule + HOG overview', () => {
  test.afterEach(async () => {
    try {
      const term = await prisma.academicTerm.findUnique({
        where: { name: TERM_NAME },
        select: { id: true },
      });
      if (term) {
        await prisma.dibbaImport.deleteMany({ where: { termId: term.id } });
        await prisma.academicTerm.delete({ where: { id: term.id } });
      }
    } catch (err) {
      console.error('[faculty-schedule e2e] cleanup failed', err);
    } finally {
      await prisma.$disconnect().catch(() => undefined);
    }
  });

  test('faculty sees only their own courses; HOG sees the term overview', async ({ page }) => {
    // --- IC: a term that contains today, the published fixture, one instructor row.
    await signIn(page, 'ic@hmp.local');
    await page.goto('/ic/dibba');
    await page.locator('#term-name').fill(TERM_NAME);
    await page.locator('#term-year').fill(String(YEAR));
    await page.locator('#term-term').selectOption(TERM_KIND);
    await page.locator('#term-start').fill(isoLocal(shift(-7)));
    await page.locator('#term-end').fill(isoLocal(shift(100)));
    await page.getByTestId('dibba-create-term-submit').click();
    await expect(page.getByTestId('dibba-create-term-done')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('dibba-term-select')).toHaveValue(/.+/);
    await page.getByTestId('dibba-term-select').selectOption({ label: TERM_NAME });
    await page.getByTestId('dibba-file-input').setInputFiles({
      name: 'course-dibba-2025-s1.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: readFileSync(FIXTURE),
    });
    await page.getByTestId('dibba-upload-submit').click();
    await page.waitForURL(/\/ic\/dibba\/[a-z0-9]+$/, { timeout: 60_000 });
    await page.getByTestId('dibba-publish-confirm').check();
    await page.getByTestId('dibba-publish-button').click();
    await expect(page.getByTestId('dibba-preview-status')).toHaveText('Published', {
      timeout: 30_000,
    });

    const term = await prisma.academicTerm.findUniqueOrThrow({
      where: { name: TERM_NAME },
      select: { id: true, imports: { where: { status: 'PUBLISHED' }, select: { id: true } } },
    });
    const importId = term.imports[0]!.id;
    const entry = await prisma.dibbaEntry.findFirstOrThrow({
      where: { importId, slotNo: { gte: 1 }, studentCount: { gt: 0 } },
      orderBy: [{ courseCode: 'asc' }, { slotNo: 'asc' }],
      select: { courseCode: true, slotNo: true },
    });
    const std = STANDARD_SLOTS.find((s) => s.slotNo === entry.slotNo)!;

    await page.goto(`/ic/dibba/terms/${term.id}/instructors`);
    await page.locator('#instructor-code').fill(entry.courseCode);
    await page.locator('#instructor-email').fill('faculty@hmp.local');
    await page.getByTestId('dibba-instructor-add-submit').click();
    await expect(page.getByTestId('dibba-instructor-add-done')).toContainText(entry.courseCode, {
      timeout: 15_000,
    });

    // --- faculty@hmp.local: the course is on the grid and in the cards; dashboard follows the term.
    await signOut(page);
    await signIn(page, 'faculty@hmp.local');
    await page.goto('/faculty/schedule');
    await expect(page.getByTestId('faculty-schedule-term')).toContainText(TERM_NAME);
    await expect(page.getByTestId(`faculty-schedule-cell-${std.day}-${std.session}`)).toContainText(
      entry.courseCode,
    );
    await expect(page.locator('[data-testid^="faculty-schedule-course-"]').first()).toContainText(
      entry.courseCode,
    );
    await expect(page.getByTestId('faculty-next-class')).toContainText(`SL${entry.slotNo}`);
    await page.goto('/faculty');
    await expect(page.getByTestId('faculty-next-events')).toBeVisible();
    await expect(page.getByText(/Term ends/)).toBeVisible();

    // --- faculty2@hmp.local teaches nothing in this Dibba: empty state, nothing leaks.
    await signOut(page);
    await signIn(page, 'faculty2@hmp.local');
    await page.goto('/faculty/schedule');
    await expect(page.getByTestId('faculty-schedule-empty')).toBeVisible();
    await expect(page.locator('[data-testid^="faculty-schedule-course-"]')).toHaveCount(0);

    // --- HOG: the overview for the term, filtered to that faculty member.
    const faculty = await prisma.user.findUniqueOrThrow({
      where: { email: 'faculty@hmp.local' },
      select: { id: true },
    });
    await signOut(page);
    await signIn(page, 'hog@hmp.local');
    await page.goto(`/hog/schedule?term=${term.id}&faculty=${faculty.id}`);
    await expect(page.getByTestId('schedule-overview-term')).toContainText(TERM_NAME);
    await expect(page.getByTestId('schedule-courses')).toContainText(entry.courseCode);
    await expect(page.getByTestId('schedule-courses-count')).toHaveText('1');
    const uncovered = page.getByTestId('schedule-uncovered');
    await expect(uncovered).toBeVisible();
    expect(Number(await uncovered.getAttribute('data-count'))).toBeGreaterThan(100);
  });
});

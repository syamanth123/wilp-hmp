import { test, expect, type Browser, type Page } from '@playwright/test';
import { prisma } from '@hmp/db';

// "Create request" from a not-started Course Dibba course with no course offering yet (Handout
// Library review, 5 Nov 2026): confirm first, then HMP adds the course + offering in the
// programme's existing semester and opens New request filled in; a programme without that
// semester stops with a plain message; only IC / Admin may do it. Seeds its own far-future term,
// Dibba and QZ* programmes, and removes everything (including audit rows) afterwards.

const YEAR = 7000 + (Date.now() % 900);
const TAG = `__e2e_dibba_request_${YEAR}__`;
const TERM = `${YEAR}-FIRST`;
const PROG_A = `QE${YEAR}A`;
const PROG_B = `QE${YEAR}B`;
const href = (codes: string[]) =>
  `/ic/requests/new?${new URLSearchParams({ courses: codes.join(','), term: TERM })}`;

async function as(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
  return page;
}

test.describe('Create request from the Course Dibba', () => {
  test.beforeAll(async () => {
    const ic = await prisma.user.findUniqueOrThrow({ where: { email: 'ic@hmp.local' } });
    const term = await prisma.academicTerm.create({
      data: {
        name: TAG,
        year: YEAR,
        term: 'FIRST',
        startDate: new Date(`${YEAR}-08-01`),
        endDate: new Date(`${YEAR}-12-15`),
      },
    });
    const entry = (
      courseCode: string,
      programmeCode: string,
      courseTitle: string,
      slotNo: number,
    ) => ({
      programmeCode,
      programmeTitle: `${programmeCode} (test)`,
      slotNo,
      slotDay: 'SAT',
      slotSession: 'FN',
      courseCode,
      courseTitle,
      rawCell: courseCode,
    });
    await prisma.dibbaImport.create({
      data: {
        termId: term.id,
        label: TAG,
        sourceFilename: `${TAG}.docx`,
        sourceFormat: 'docx',
        status: 'PUBLISHED',
        publishedAt: new Date(),
        rowCount: 3,
        uploadedById: ic.id,
        entries: {
          create: [
            entry('QZEA ZC901', PROG_A, 'TEST MATERIALS', 1),
            entry('QZEB ZC904', PROG_B, 'TEST MATERIALS', 1),
            entry('QZEC ZC902', PROG_B, 'ONLY IN B', 2),
          ],
        },
      },
    });
    await prisma.programme.create({
      data: {
        code: PROG_A,
        name: 'Dibba request test A',
        semesters: {
          create: {
            name: `Sem-I ${YEAR}`,
            year: YEAR,
            term: 'FIRST',
            startDate: new Date(`${YEAR}-08-01`),
            endDate: new Date(`${YEAR}-12-15`),
          },
        },
      },
    });
    await prisma.programme.create({ data: { code: PROG_B, name: 'Dibba request test B' } });
  });

  test.afterAll(async () => {
    const courses = await prisma.course.findMany({
      where: { bitsCourseNumber: { startsWith: 'QZE' } },
      select: { id: true, offerings: { select: { id: true } } },
    });
    const offeringIds = courses.flatMap((c) => c.offerings.map((o) => o.id));
    await prisma.auditLog.deleteMany({
      where: { entityId: { in: [...courses.map((c) => c.id), ...offeringIds] } },
    });
    await prisma.courseOffering.deleteMany({ where: { id: { in: offeringIds } } });
    await prisma.course.deleteMany({ where: { id: { in: courses.map((c) => c.id) } } });
    await prisma.programme.deleteMany({ where: { code: { in: [PROG_A, PROG_B] } } });
    await prisma.dibbaImport.deleteMany({ where: { label: TAG } });
    await prisma.academicTerm.deleteMany({ where: { name: TAG } });
  });

  test('IC confirms; HMP adds the course and offering, then New request is filled in', async ({
    browser,
  }) => {
    const page = await as(browser, 'ic@hmp.local');
    await page.goto(href(['QZEA ZC901', 'QZEB ZC904']));
    const dialog = page.getByTestId('setup-confirm');
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('setup-summary')).toHaveText(
      `This will add QZEA ZC901 / QZEB ZC904 to Sem-I ${YEAR} (${PROG_A}) and open a new request.`,
    );
    await expect(page.getByTestId('setup-codes')).toContainText('QZEA ZC901, QZEB ZC904');
    await expect(page.getByTestId('setup-mixed-numbers')).toBeVisible();
    await expect(page.getByTestId('setup-not-set-up')).toContainText(PROG_B);
    // Nothing is written before the confirmation.
    expect(await prisma.course.count({ where: { bitsCourseNumber: 'QZEA ZC901' } })).toBe(0);

    await page.getByTestId('setup-confirm-button').click();
    await page.waitForURL(/added=1/);
    await expect(page.getByTestId('prefill-note')).toContainText(
      'This request covers all 2 codes: QZEA ZC901, QZEB ZC904.',
    );
    const offering = await prisma.courseOffering.findFirstOrThrow({
      where: { course: { bitsCourseNumber: 'QZEA ZC901' } },
      select: { id: true },
    });
    await expect(page.locator('#rf-course')).toHaveValue(offering.id);
    await page.context().close();
  });

  test('a programme with no semester for the term stops with a plain message', async ({
    browser,
  }) => {
    const page = await as(browser, 'ic@hmp.local');
    await page.goto(href(['QZEC ZC902']));
    const note = page.getByTestId('prefill-note');
    await expect(note).toHaveAttribute('data-reason', 'semester-missing');
    await expect(note).toContainText(
      `Sem-I ${YEAR} isn't set up for programme ${PROG_B} yet — ask Admin to add it.`,
    );
    await expect(page.getByTestId('setup-confirm')).toHaveCount(0);
    await expect(page.locator('#rf-course')).toHaveCount(0);
    await page.context().close();
  });

  test('faculty are refused', async ({ browser }) => {
    const page = await as(browser, 'faculty@hmp.local');
    await page.goto(href(['QZEC ZC902']));
    await expect(page.getByTestId('access-denied')).toBeVisible();
    await expect(page.getByTestId('setup-confirm')).toHaveCount(0);
    await page.context().close();
  });
});

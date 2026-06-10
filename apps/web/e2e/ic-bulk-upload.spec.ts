import { test, expect, type Page } from '@playwright/test';
import { PrismaClient } from '@hmp/db';

// Prompt 13 — IC bulk handout-request CSV upload.
//
// Cleanup-by-fixture convention (audit §1): the spec seeds its OWN sentinel
// programme/semester/course/offering graph in beforeEach, references it through
// the test, and deletes EVERYTHING it created in afterEach inside try/finally
// so a mid-test failure can't leave permanent dev-DB pollution. Created
// HandoutRequests carry real HMP-YYYY refNos, so they're cleaned by their
// (sentinel) courseOfferingId, not by a refNo prefix.

const prisma = new PrismaClient();

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

interface Graph {
  tag: string;
  progA: string;
  progB: string;
  sem: string;
  offeringIds: string[];
  courseIds: string[];
  semId: string;
  progIds: string[];
}

let g: Graph;

test.beforeEach(async () => {
  const tag = `E2EBULK-${process.pid}-${Date.now()}`;
  const progA = await prisma.programme.create({ data: { code: `${tag}-PA`, name: `${tag} A` } });
  const progB = await prisma.programme.create({ data: { code: `${tag}-PB`, name: `${tag} B` } });
  const sem = await prisma.semester.create({
    data: {
      programmeId: progA.id,
      name: `${tag}-Sem`,
      year: 2099,
      term: 'FIRST',
      startDate: new Date('2099-01-01'),
      endDate: new Date('2099-06-01'),
    },
  });
  const c1 = await prisma.course.create({
    data: { bitsCourseNumber: 'BLK ZG801', code: `${tag}-C1`, title: `${tag} C1` },
  });
  const c2 = await prisma.course.create({
    data: { bitsCourseNumber: 'BLK ZG802', code: `${tag}-C2`, title: `${tag} C2` },
  });
  const off1 = await prisma.courseOffering.create({
    data: { courseId: c1.id, semesterId: sem.id },
  });
  const off2 = await prisma.courseOffering.create({
    data: { courseId: c2.id, semesterId: sem.id },
  });
  g = {
    tag,
    progA: progA.code,
    progB: progB.code,
    sem: sem.name,
    offeringIds: [off1.id, off2.id],
    courseIds: [c1.id, c2.id],
    semId: sem.id,
    progIds: [progA.id, progB.id],
  };
});

test.afterEach(async () => {
  try {
    const reqs = await prisma.handoutRequest.findMany({
      where: { courseOfferingId: { in: g.offeringIds } },
      select: { id: true },
    });
    const reqIds = reqs.map((r) => r.id);
    if (reqIds.length) {
      await prisma.auditLog.deleteMany({ where: { requestId: { in: reqIds } } });
      await prisma.approval.deleteMany({ where: { requestId: { in: reqIds } } });
      await prisma.handoutRequest.deleteMany({ where: { id: { in: reqIds } } });
    }
    await prisma.courseOffering.deleteMany({ where: { id: { in: g.offeringIds } } });
    await prisma.course.deleteMany({ where: { id: { in: g.courseIds } } });
    await prisma.semester.deleteMany({ where: { id: g.semId } });
    await prisma.programme.deleteMany({ where: { id: { in: g.progIds } } });
  } catch (err) {
    // Always attempt cleanup; surface failures rather than silently polluting.
    console.error('[ic-bulk-upload] cleanup failed', err);
  }
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

async function uploadCsv(page: Page, csv: string) {
  await page.getByTestId('bulk-csv-file').setInputFiles({
    name: 'upload.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv, 'utf8'),
  });
  await page.getByTestId('bulk-process-button').click();
}

test('IC uploads a valid CSV → 2 requests created, refNos shown', async ({ page }) => {
  await signIn(page, 'ic@hmp.local');
  await page.goto('/ic/requests/bulk-upload');

  await uploadCsv(
    page,
    `programme_code,course_code,semester
${g.progA},BLK ZG801,${g.sem}
${g.progA},BLK ZG802,${g.sem}`,
  );

  await expect(page.getByTestId('bulk-success')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('bulk-success')).toContainText(/Created 2 handout requests/i);
  await expect(page.getByTestId('bulk-refnos').locator('li')).toHaveCount(2);

  // DB confirms 2 REQUESTED rows on the sentinel offerings.
  const rows = await prisma.handoutRequest.findMany({
    where: { courseOfferingId: { in: g.offeringIds } },
    select: { status: true },
  });
  expect(rows).toHaveLength(2);
  expect(rows.every((r) => r.status === 'REQUESTED')).toBe(true);
});

test('IC uploads a CSV with an unknown programme → rejected, download offered, no requests created', async ({
  page,
}) => {
  await signIn(page, 'ic@hmp.local');
  await page.goto('/ic/requests/bulk-upload');

  await uploadCsv(
    page,
    `programme_code,course_code,semester
${g.progA},BLK ZG801,${g.sem}
NOPE-${g.tag},BLK ZG802,${g.sem}`,
  );

  const rejected = page.getByTestId('bulk-rejected');
  await expect(rejected).toBeVisible({ timeout: 15_000 });
  await expect(rejected).toContainText(/programme_not_found/);
  await expect(page.getByTestId('bulk-download-rejected')).toBeVisible();

  // Atomic: nothing created despite row 1 being valid.
  const count = await prisma.handoutRequest.count({
    where: { courseOfferingId: { in: g.offeringIds } },
  });
  expect(count).toBe(0);
});

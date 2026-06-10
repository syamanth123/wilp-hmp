import { test, expect, type Page } from '@playwright/test';
import { PrismaClient } from '@hmp/db';

// Prompt 14 — HOG bulk faculty + SME allocation CSV upload.
//
// Cleanup-by-fixture (audit §1): seeds its own sentinel programme / semester /
// offerings + REQUESTED requests in beforeEach, references the seeded
// faculty@hmp.local + sme@hmp.local, and tears everything down in afterEach
// inside try/finally. Created allocations are cleaned via the sentinel requests
// (cascade), so no real data is touched.

const prisma = new PrismaClient();

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

interface G {
  progId: string;
  semId: string;
  courseIds: string[];
  offeringIds: string[];
  requestIds: string[];
  refNos: string[];
}
let g: G;

test.beforeEach(async () => {
  const tag = `E2EALLOC-${process.pid}-${Date.now()}`;
  const ic = await prisma.user.findUniqueOrThrow({
    where: { email: 'ic@hmp.local' },
    select: { id: true },
  });
  const prog = await prisma.programme.create({ data: { code: `${tag}-P`, name: `${tag}` } });
  const sem = await prisma.semester.create({
    data: {
      programmeId: prog.id,
      name: `${tag}-Sem`,
      year: 2099,
      term: 'FIRST',
      startDate: new Date('2099-01-01'),
      endDate: new Date('2099-06-01'),
    },
  });
  const courseIds: string[] = [];
  const offeringIds: string[] = [];
  const requestIds: string[] = [];
  const refNos: string[] = [];
  for (let i = 1; i <= 2; i++) {
    const c = await prisma.course.create({
      data: { bitsCourseNumber: `BA ZG${810 + i}`, code: `${tag}-C${i}`, title: `${tag} C${i}` },
    });
    const off = await prisma.courseOffering.create({
      data: { courseId: c.id, semesterId: sem.id },
    });
    const refNo = `${tag}-R${i}`;
    const req = await prisma.handoutRequest.create({
      data: { refNo, courseOfferingId: off.id, initiatedById: ic.id, status: 'REQUESTED' },
      select: { id: true },
    });
    courseIds.push(c.id);
    offeringIds.push(off.id);
    requestIds.push(req.id);
    refNos.push(refNo);
  }
  g = { progId: prog.id, semId: sem.id, courseIds, offeringIds, requestIds, refNos };
});

test.afterEach(async () => {
  try {
    for (const id of g.requestIds) {
      await prisma.notification.deleteMany({
        where: { meta: { path: ['requestId'], equals: id } },
      });
      await prisma.auditLog.deleteMany({ where: { requestId: id } });
      await prisma.handoutRequest.delete({ where: { id } }).catch(() => {});
    }
    await prisma.courseOffering.deleteMany({ where: { id: { in: g.offeringIds } } });
    await prisma.course.deleteMany({ where: { id: { in: g.courseIds } } });
    await prisma.semester.deleteMany({ where: { id: g.semId } });
    await prisma.programme.deleteMany({ where: { id: g.progId } });
  } catch (err) {
    console.error('[hog-bulk-allocate] cleanup failed', err);
  }
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

async function uploadCsv(page: Page, csv: string) {
  await page
    .getByTestId('bulk-csv-file')
    .setInputFiles({ name: 'alloc.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
  await page.getByTestId('bulk-process-button').click();
}

test('HOG uploads a valid allocation CSV → 2 requests ALLOCATED', async ({ page }) => {
  await signIn(page, 'hog@hmp.local');
  await page.goto('/hog/requests/bulk-allocate');

  await uploadCsv(
    page,
    `request_reference,faculty_emails,sme_email
${g.refNos[0]},faculty@hmp.local,sme@hmp.local
${g.refNos[1]},faculty@hmp.local,sme@hmp.local`,
  );

  await expect(page.getByTestId('bulk-success')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('bulk-success')).toContainText(/Allocated 2 requests/i);
  await expect(page.getByTestId('bulk-refnos').locator('li')).toHaveCount(2);

  const rows = await prisma.handoutRequest.findMany({
    where: { id: { in: g.requestIds } },
    select: { status: true },
  });
  expect(rows.every((r) => r.status === 'ALLOCATED')).toBe(true);
  const fa = await prisma.facultyAssignment.count({ where: { requestId: { in: g.requestIds } } });
  const sa = await prisma.smeAssignment.count({ where: { requestId: { in: g.requestIds } } });
  expect(fa).toBe(2);
  expect(sa).toBe(2);
});

test('HOG uploads a CSV with an unknown refNo → rejected, download offered, nothing allocated', async ({
  page,
}) => {
  await signIn(page, 'hog@hmp.local');
  await page.goto('/hog/requests/bulk-allocate');

  await uploadCsv(
    page,
    `request_reference,faculty_emails,sme_email
${g.refNos[0]},faculty@hmp.local,sme@hmp.local
HMP-9999-9999,faculty@hmp.local,sme@hmp.local`,
  );

  const rejected = page.getByTestId('bulk-rejected');
  await expect(rejected).toBeVisible({ timeout: 15_000 });
  await expect(rejected).toContainText(/request_not_found/);
  await expect(page.getByTestId('bulk-download-rejected')).toBeVisible();

  // Atomic: row 1 was valid but nothing committed.
  const rows = await prisma.handoutRequest.findMany({
    where: { id: { in: g.requestIds } },
    select: { status: true },
  });
  expect(rows.every((r) => r.status === 'REQUESTED')).toBe(true);
});

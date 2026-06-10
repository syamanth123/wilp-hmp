import { test, expect, type Page } from '@playwright/test';
import { PrismaClient } from '@hmp/db';

// Prompt 15 — bulk review actions (PC / SME / HOG). Cleanup-by-fixture: seeds
// its own sentinel programme / semester / offerings + requests parked at the
// right status (with SmeAssignments where needed) in beforeEach, and tears
// everything down in afterEach inside try/finally.

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
  smeApproveRef: string; // SME_REVIEW, assigned to sme@hmp.local
  smeRevertRef: string; // SME_REVIEW, assigned to sme@hmp.local
  smeRevertHandoutId: string;
  pcRef: string; // SUBMITTED
  notYoursRef: string; // SME_REVIEW, assigned to someone else
}
let g: G;

test.beforeEach(async () => {
  const tag = `E2EREV-${process.pid}-${Date.now()}`;
  const ic = await prisma.user.findUniqueOrThrow({
    where: { email: 'ic@hmp.local' },
    select: { id: true },
  });
  const sme = await prisma.user.findUniqueOrThrow({
    where: { email: 'sme@hmp.local' },
    select: { id: true },
  });
  const other = await prisma.user.findUniqueOrThrow({
    where: { email: 'hog@hmp.local' },
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
  let seq = 0;
  const mk = async (status: string, assignedSme?: string) => {
    seq += 1;
    const c = await prisma.course.create({
      data: {
        bitsCourseNumber: `BR ZG${600 + seq}`,
        code: `${tag}-C${seq}`,
        title: `${tag} C${seq}`,
      },
    });
    const off = await prisma.courseOffering.create({
      data: { courseId: c.id, semesterId: sem.id },
    });
    const req = await prisma.handoutRequest.create({
      data: {
        refNo: `${tag}-R${seq}`,
        courseOfferingId: off.id,
        initiatedById: ic.id,
        status: status as never,
        handout: { create: { status: status as never } },
        ...(assignedSme
          ? { smeAssignment: { create: { smeUserId: assignedSme, assignedById: ic.id } } }
          : {}),
      },
      select: { id: true, refNo: true, handout: { select: { id: true } } },
    });
    courseIds.push(c.id);
    offeringIds.push(off.id);
    requestIds.push(req.id);
    return { refNo: req.refNo, handoutId: req.handout!.id };
  };

  const a = await mk('SME_REVIEW', sme.id);
  const b = await mk('SME_REVIEW', sme.id);
  const p = await mk('SUBMITTED');
  const n = await mk('SME_REVIEW', other.id);
  g = {
    progId: prog.id,
    semId: sem.id,
    courseIds,
    offeringIds,
    requestIds,
    smeApproveRef: a.refNo,
    smeRevertRef: b.refNo,
    smeRevertHandoutId: b.handoutId,
    pcRef: p.refNo,
    notYoursRef: n.refNo,
  };
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
    console.error('[bulk-review] cleanup failed', err);
  }
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

async function upload(page: Page, csv: string) {
  await page
    .getByTestId('bulk-csv-file')
    .setInputFiles({ name: 'review.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
  await page.getByTestId('bulk-process-button').click();
}

test('SME bulk approve + revert → statuses change and the revert writes a Comment row', async ({
  page,
}) => {
  await signIn(page, 'sme@hmp.local');
  await page.goto('/sme/bulk-review');
  await upload(
    page,
    `request_reference,action,comment
${g.smeApproveRef},sme_approve,
${g.smeRevertRef},sme_revert,Please add the experiential-learning component`,
  );
  await expect(page.getByTestId('bulk-success')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('bulk-success')).toContainText(/Applied 2 actions/i);

  expect(
    (
      await prisma.handoutRequest.findUnique({
        where: { refNo: g.smeApproveRef },
        select: { status: true },
      })
    )?.status,
  ).toBe('SUBMITTED');
  expect(
    (
      await prisma.handoutRequest.findUnique({
        where: { refNo: g.smeRevertRef },
        select: { status: true },
      })
    )?.status,
  ).toBe('REWORK_REQUESTED');
  // The revert must have produced a Comment-thread row (faculty banner feed).
  const comment = await prisma.comment.count({ where: { handoutId: g.smeRevertHandoutId } });
  expect(comment).toBeGreaterThan(0);
});

test('PC bulk approve → UNDER_REVIEW', async ({ page }) => {
  await signIn(page, 'pc@hmp.local');
  await page.goto('/pc/bulk-review');
  await upload(page, `request_reference,action,comment\n${g.pcRef},pc_approve,`);
  await expect(page.getByTestId('bulk-success')).toBeVisible({ timeout: 15_000 });
  expect(
    (
      await prisma.handoutRequest.findUnique({
        where: { refNo: g.pcRef },
        select: { status: true },
      })
    )?.status,
  ).toBe('UNDER_REVIEW');
});

test('SME acting on a request assigned to another SME → rejected, nothing applied', async ({
  page,
}) => {
  await signIn(page, 'sme@hmp.local');
  await page.goto('/sme/bulk-review');
  await upload(page, `request_reference,action,comment\n${g.notYoursRef},sme_approve,`);
  const rejected = page.getByTestId('bulk-rejected');
  await expect(rejected).toBeVisible({ timeout: 15_000 });
  await expect(rejected).toContainText(/not_your_sme_assignment/);
  expect(
    (
      await prisma.handoutRequest.findUnique({
        where: { refNo: g.notYoursRef },
        select: { status: true },
      })
    )?.status,
  ).toBe('SME_REVIEW'); // untouched
});

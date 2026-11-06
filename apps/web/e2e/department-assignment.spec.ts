import { test, expect, type Browser, type Page } from '@playwright/test';
import { PrismaClient, RoleName } from '@hmp/db';

// v1.4.1 — department-based pickers, scoping, who is told, change HOG, the H4 preview and the H9
// notice (docs/plans/v1.4.1-assignment.md). Dev seed: hog@ / pc@ are CSIS (MTECH programmes);
// hog.mba@ / pc.mba@ are MBA (MBA-WILP). Everything this spec makes is removed in `finally`.

const prisma = new PrismaClient();
const TAG = `e2e-dept-${process.pid}-${Date.now()}`;

async function signIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
  return page;
}

const userId = async (email: string) =>
  (await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })).id;

/** Who was told about this request (in-portal notifications). */
async function toldAbout(requestId: string): Promise<Set<string>> {
  const rows = await prisma.notification.findMany({
    where: { meta: { path: ['requestId'], equals: requestId } },
    select: { user: { select: { email: true } } },
  });
  return new Set(rows.map((r) => r.user.email));
}

async function removeRequests(ids: string[]) {
  if (!ids.length) return;
  for (const id of ids)
    await prisma.notification.deleteMany({ where: { meta: { path: ['requestId'], equals: id } } });
  await prisma.auditLog.deleteMany({
    where: { OR: [{ requestId: { in: ids } }, { entityId: { in: ids } }] },
  });
  await prisma.handoutRequest.deleteMany({ where: { id: { in: ids } } });
}

/** A request waiting for allocation on the CSIS course SE ZG501 (MTECH-SE), with no HOG recorded. */
async function mkRequested(): Promise<{ requestId: string; refNo: string }> {
  const offering = await prisma.courseOffering.findFirstOrThrow({
    where: { course: { code: 'SE ZG501' }, semester: { programme: { code: 'MTECH-SE' } } },
    select: { id: true },
  });
  const r = await prisma.handoutRequest.create({
    data: {
      refNo: `HMP-8877-${process.hrtime.bigint().toString(36)}`,
      courseOfferingId: offering.id,
      initiatedById: await userId('ic@hmp.local'),
      status: 'REQUESTED',
    },
    select: { id: true, refNo: true },
  });
  return { requestId: r.id, refNo: r.refNo };
}

test.afterAll(async () => {
  await prisma.$disconnect();
});

test('IC → New request: the CSIS HOG is pre-selected, only they are told; the MBA HOG can’t open it; change HOG', async ({
  browser,
}) => {
  const created: string[] = [];
  try {
    const ic = await signIn(browser, 'ic@hmp.local');
    await ic.goto('/ic/requests/new');
    await ic.getByLabel('Programme').selectOption('MTECH-DS');
    await ic.getByLabel('Semester').selectOption({ index: 1 });
    await ic.getByLabel('Course').selectOption({ label: /CC ZG501/ });
    const hogPicker = ic.getByTestId('rf-hog');
    await expect(hogPicker).toHaveValue(await userId('hog@hmp.local'));
    await expect(hogPicker.locator('option:checked')).toContainText('open handout');
    await expect(ic.getByTestId('rf-hog-hint')).toContainText('pre-selected');
    await ic.getByRole('button', { name: /create request/i }).click();
    await ic.waitForURL(/\/ic\/requests\/c[a-z0-9]{20,}/i);
    const requestId = ic.url().split('/').pop()!;
    created.push(requestId);
    const refNo = (await prisma.handoutRequest.findUniqueOrThrow({ where: { id: requestId } }))
      .refNo;
    await expect(ic.getByTestId('handover-hog-current')).toContainText('Head of Group');

    // Only the CSIS HOG was told.
    await expect.poll(async () => (await toldAbout(requestId)).has('hog@hmp.local')).toBe(true);
    expect((await toldAbout(requestId)).has('hog.mba@hmp.local')).toBe(false);

    // The MBA HOG doesn't see it in the list and gets "not found" by address.
    const mba = await signIn(browser, 'hog.mba@hmp.local');
    await mba.goto('/hog/requests');
    await expect(mba.getByText(refNo)).toHaveCount(0);
    const res = await mba.goto(`/hog/requests/${requestId}`);
    expect(res?.status()).toBe(404);

    // The IC hands it to the MBA HOG, with a reason; now the MBA HOG can open it.
    await ic.getByTestId('handover-hog-open').click();
    await ic.getByTestId('handover-hog-to').selectOption(await userId('hog.mba@hmp.local'));
    await ic.getByTestId('handover-hog-reason').fill('Dr CSIS HOG is on leave this week');
    await ic.getByTestId('handover-hog-save').click();
    await expect(ic.getByTestId('handover-hog-current')).toContainText('Meera Iyer');
    await expect.poll(async () => (await toldAbout(requestId)).has('hog.mba@hmp.local')).toBe(true);
    const res2 = await mba.goto(`/hog/requests/${requestId}`);
    expect(res2?.status()).toBe(200);
    await ic.context().close();
    await mba.context().close();
  } finally {
    await removeRequests(created);
  }
});

test('HOG → Allocate: department first, the department PC pre-selected; only that PC is told', async ({
  browser,
}) => {
  const seeded = await mkRequested();
  await prisma.requestAssignee.create({
    data: {
      requestId: seeded.requestId,
      role: RoleName.HOG,
      userId: await userId('hog@hmp.local'),
    },
  });
  const hog = await signIn(browser, 'hog@hmp.local');
  await hog.goto(`/hog/requests/${seeded.requestId}`);
  await expect(hog.getByTestId('alloc-department')).toContainText('CSIS');
  await expect(hog.getByTestId('pc-picker')).toHaveValue(await userId('pc@hmp.local'));
  // The faculty list (not the "Show all departments" box): the first one who can take it.
  await hog.locator('ul input[type="checkbox"]:not([disabled])').first().check();
  await hog.getByTestId('sme-picker').selectOption({ index: 1 });
  await hog.getByRole('button', { name: /^Allocate/ }).click();
  await expect(hog.locator('[data-status="ALLOCATED"]').first()).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => (await toldAbout(seeded.requestId)).has('pc@hmp.local')).toBe(true);
  expect((await toldAbout(seeded.requestId)).has('pc.mba@hmp.local')).toBe(false);
  const pcRow = await prisma.requestAssignee.findFirst({
    where: { requestId: seeded.requestId, role: RoleName.PROGRAMME_COMMITTEE, endedAt: null },
    select: { user: { select: { email: true } } },
  });
  expect(pcRow?.user.email).toBe('pc@hmp.local');
  await hog.context().close();
  await removeRequests([seeded.requestId]);
});

test('New request: a department with no HOG says so, with a link to People (H13)', async ({
  browser,
}) => {
  const mbaProgramme = await prisma.programme.findUniqueOrThrow({ where: { code: 'MBA-WILP' } });
  const eee = await prisma.department.findUniqueOrThrow({ where: { code: 'EEE' } });
  try {
    // EEE has no HOG in the dev data: move MBA-WILP there for this test only.
    await prisma.programme.update({
      where: { id: mbaProgramme.id },
      data: { departmentId: eee.id },
    });
    const ic = await signIn(browser, 'ic@hmp.local');
    await ic.goto('/ic/requests/new');
    await ic.getByLabel('Programme').selectOption('MBA-WILP');
    await ic.getByLabel('Semester').selectOption({ index: 1 });
    await ic.getByLabel('Course').selectOption({ index: 1 });
    const note = ic.getByTestId('rf-no-hog');
    await expect(note).toContainText('EEE has no HOG yet — set one in People');
    await expect(note.getByRole('link', { name: 'set one in People' })).toHaveAttribute(
      'href',
      `/ic/people?department=${eee.id}`,
    );
    await expect(ic.getByTestId('rf-hog')).toHaveValue('');
    await ic.context().close();
  } finally {
    await prisma.programme.update({
      where: { id: mbaProgramme.id },
      data: { departmentId: mbaProgramme.departmentId },
    });
  }
});

test('Departments: existing requests without a HOG are previewed with the HOG they would get (H4)', async ({
  browser,
}) => {
  const seeded = await mkRequested();
  const ic = await signIn(browser, 'ic@hmp.local');
  await ic.goto('/ic/departments');
  const row = ic.getByTestId('hog-backfill-row').filter({ hasText: seeded.refNo });
  await expect(row).toContainText('(CSIS)');
  await expect(ic.getByTestId('hog-backfill-apply')).toBeVisible();
  // Preview only: nothing was written.
  expect(
    await prisma.requestAssignee.count({
      where: { requestId: seeded.requestId, role: RoleName.HOG },
    }),
  ).toBe(0);
  await ic.context().close();
  await removeRequests([seeded.requestId]);
});

test('H9: a HOG with no department sees every department, and is told so', async ({ browser }) => {
  const hogRole = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.HOG } });
  const passwordHash = (await prisma.user.findUniqueOrThrow({ where: { email: 'hog@hmp.local' } }))
    .passwordHash;
  const email = `nodept.${TAG}@hmp.local`;
  const u = await prisma.user.create({
    data: {
      email,
      name: `E2E no-dept HOG ${TAG}`,
      passwordHash,
      roles: { create: { roleId: hogRole.id } },
    },
  });
  try {
    const page = await signIn(browser, email);
    await page.goto('/hog');
    await expect(page.getByTestId('department-notice')).toContainText(
      /Your department isn.t set — you see all departments/,
    );
    await page.context().close();
  } finally {
    await prisma.notification.deleteMany({ where: { userId: u.id } });
    await prisma.auditLog.deleteMany({ where: { actorId: u.id } });
    await prisma.userRole.deleteMany({ where: { userId: u.id } });
    await prisma.user.delete({ where: { id: u.id } });
  }
});

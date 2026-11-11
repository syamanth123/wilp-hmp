import { test, expect, type Browser, type Page } from '@playwright/test';
import { PrismaClient, RoleName } from '@hmp/db';

// v1.4.2 — My work, away / back-up, duplicate guard, @mentions, undo, calendar link, and the new pages
// (docs/plans/v1.4.2-workload.md). Dev seed: hog@ / pc@ are CSIS (MTECH programmes); pc.mba@ is MBA.
// Everything this spec makes is removed in `finally` / afterAll.

const prisma = new PrismaClient();
const REF = 'HMP-8878-';
const DAY = 86_400_000;

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

async function mkRequest(
  status: 'REQUESTED' | 'ALLOCATED',
  days: number,
): Promise<{ id: string; refNo: string; offeringId: string }> {
  const offering = await prisma.courseOffering.findFirstOrThrow({
    where: { course: { code: 'SE ZG501' }, semester: { programme: { code: 'MTECH-SE' } } },
    select: { id: true },
  });
  const r = await prisma.handoutRequest.create({
    data: {
      refNo: `${REF}${process.hrtime.bigint().toString(36)}`,
      courseOfferingId: offering.id,
      initiatedById: await userId('ic@hmp.local'),
      status,
      statusChangedAt: new Date(Date.now() - days * DAY),
      handout: { create: { status } },
    },
    select: { id: true, refNo: true },
  });
  return { ...r, offeringId: offering.id };
}

async function cleanUp() {
  const reqs = await prisma.handoutRequest.findMany({
    where: { refNo: { startsWith: REF } },
    select: { id: true },
  });
  const ids = reqs.map((r) => r.id);
  for (const id of ids)
    await prisma.notification.deleteMany({ where: { meta: { path: ['requestId'], equals: id } } });
  await prisma.auditLog.deleteMany({
    where: { OR: [{ requestId: { in: ids } }, { entityId: { in: ids } }] },
  });
  await prisma.handoutRequest.deleteMany({ where: { id: { in: ids } } });
  await prisma.userPreference.deleteMany({
    where: { user: { email: { in: ['pc@hmp.local', 'pc.mba@hmp.local', 'faculty@hmp.local'] } } },
  });
}

test.beforeAll(cleanUp);
test.afterAll(async () => {
  await cleanUp();
  await prisma.$disconnect();
});

test('HOG home: My work lists the overdue allocation; the request page shows its due dates', async ({
  browser,
}) => {
  const r = await mkRequest('REQUESTED', 10);
  await prisma.requestAssignee.create({
    data: { requestId: r.id, role: RoleName.HOG, userId: await userId('hog@hmp.local') },
  });
  const hog = await signIn(browser, 'hog@hmp.local');
  await hog.goto('/hog');
  const item = hog.getByTestId('my-work-item').filter({ hasText: r.refNo });
  await expect(item).toContainText('Allocate faculty, SME and PC');
  await expect(item).toContainText('overdue');
  await item.getByRole('link').click();
  await expect(hog.getByTestId('stage-deadlines')).toContainText('Allocation');
  await expect(
    hog.getByTestId('shortcuts-tip').or(hog.getByTestId('stage-deadlines')),
  ).toBeVisible();
});

test('Away: the PC’s back-up sees the allocation in My work, “for” the PC, and can open it', async ({
  browser,
}) => {
  const r = await mkRequest('ALLOCATED', 1);
  const pc = await userId('pc@hmp.local');
  await prisma.requestAssignee.create({
    data: { requestId: r.id, role: RoleName.PROGRAMME_COMMITTEE, userId: pc },
  });
  await prisma.userPreference.create({
    data: {
      userId: pc,
      awayUntil: new Date(Date.now() + 3 * DAY),
      backupUserId: await userId('pc.mba@hmp.local'),
    },
  });
  const mba = await signIn(browser, 'pc.mba@hmp.local');
  await mba.goto('/pc');
  const item = mba.getByTestId('my-work-item').filter({ hasText: r.refNo });
  await expect(item.getByTestId('my-work-for')).toContainText('for Programme Committee (away)');
  await mba.goto(`/pc/requests/${r.id}`);
  await expect(mba.getByText(r.refNo).first()).toBeVisible();

  const away = await signIn(browser, 'pc@hmp.local');
  await away.goto('/settings');
  await expect(away.getByTestId('away-now')).toContainText('Dr. Arjun Rao');
});

test('New request: a course that already has a request this semester is blocked, with a link', async ({
  browser,
}) => {
  const r = await mkRequest('REQUESTED', 0);
  const ic = await signIn(browser, 'ic@hmp.local');
  await ic.goto('/ic/requests/new');
  await ic.getByLabel('Programme').selectOption('MTECH-SE');
  await ic.getByLabel('Semester').selectOption({ index: 1 });
  await ic.getByLabel('Course').selectOption(r.offeringId);
  await expect(ic.getByTestId('rf-duplicate')).toContainText('already exists');
  await expect(ic.getByRole('button', { name: 'Create request' })).toBeDisabled();
});

test('@mention: the HOG picked from the list gets a notice and an email', async ({ browser }) => {
  const r = await mkRequest('REQUESTED', 0);
  const hogId = await userId('hog@hmp.local');
  await prisma.requestAssignee.create({
    data: { requestId: r.id, role: RoleName.HOG, userId: hogId },
  });
  const ic = await signIn(browser, 'ic@hmp.local');
  await ic.goto(`/ic/requests/${r.id}`);
  const box = ic.getByTestId('comment-body');
  await box.click();
  await box.pressSequentially('Please allocate soon, @Head');
  await ic
    .getByTestId('mention-list')
    .getByRole('button', { name: /Head of Group/ })
    .click();
  await expect(box).toHaveValue('Please allocate soon, @Head of Group ');
  await ic.getByRole('button', { name: 'Post comment' }).click();
  await expect
    .poll(
      async () =>
        (
          await prisma.notification.findMany({
            where: { userId: hogId, meta: { path: ['kind'], equals: 'comment.mention' } },
            select: { channel: true, meta: true },
          })
        )
          .filter((n) => (n.meta as { requestId?: string }).requestId === r.id)
          .map((n) => n.channel)
          .sort(),
      { timeout: 15_000 },
    )
    .toEqual(['EMAIL', 'IN_PORTAL']);
});

test('Undo: a role change on Edit person can be undone', async ({ browser }) => {
  const guest = await prisma.user.findUniqueOrThrow({
    where: { email: 'faculty.guest@hmp.local' },
    select: { id: true },
  });
  const since = new Date();
  try {
    const admin = await signIn(browser, 'admin@hmp.local');
    await admin.goto(`/admin/people/${guest.id}`);
    await admin.getByTestId('person-role-SME').check();
    await admin.getByTestId('person-save').click();
    await expect
      .poll(async () =>
        prisma.userRole.count({ where: { userId: guest.id, role: { name: RoleName.SME } } }),
      )
      .toBe(1);
    await admin.goto(`/admin/people/${guest.id}`);
    await admin.getByTestId('undo-button').click();
    await expect(admin.getByText('Undone.')).toBeVisible();
    expect(
      await prisma.userRole.count({ where: { userId: guest.id, role: { name: RoleName.SME } } }),
    ).toBe(0);
  } finally {
    await prisma.userRole.deleteMany({ where: { userId: guest.id, role: { name: RoleName.SME } } });
    await prisma.auditLog.deleteMany({
      where: {
        entityId: guest.id,
        action: { in: ['user.update', 'user.undo'] },
        createdAt: { gte: since },
      },
    });
  }
});

test('Calendar link: works, is replaced, and the old one stops', async ({ browser, request }) => {
  const fac = await signIn(browser, 'faculty@hmp.local');
  await fac.goto('/settings');
  await fac.getByTestId('calendar-make').click();
  const first = new URL(await fac.getByTestId('calendar-link').inputValue()).pathname;
  expect(first).toMatch(/^\/api\/calendar\/[A-Za-z0-9_-]+\.ics$/);
  const ok = await request.get(first);
  expect(ok.status()).toBe(200);
  expect(ok.headers()['content-type']).toContain('text/calendar');
  expect(await ok.text()).toContain('BEGIN:VCALENDAR');
  await fac.getByTestId('calendar-make').click(); // Replace link
  await expect(fac.getByTestId('calendar-link')).not.toHaveValue(new RegExp(first));
  expect((await request.get(first)).status()).toBe(404);
  const dl = await fac.request.get('/api/calendar/download');
  expect(dl.status()).toBe(200);
});

test('New pages load: department dashboard, kick-off, Admin → Workflow preview', async ({
  browser,
}) => {
  const ic = await signIn(browser, 'ic@hmp.local');
  await ic.goto('/ic/dashboard');
  await expect(ic.getByTestId('department-table')).toBeVisible();
  await expect(ic.getByTestId('workload-table')).toBeVisible();
  await ic.goto('/ic/kick-off');
  await expect(
    ic
      .getByRole('heading', { name: 'Kick off a semester' })
      .or(ic.getByText('Kick off a semester').first()),
  ).toBeVisible();
  const admin = await signIn(browser, 'admin@hmp.local');
  await admin.goto('/admin/workflow');
  await expect(admin.getByTestId('run-preview')).toBeVisible();
  await expect(admin.getByTestId('escalation-on')).not.toBeChecked();
  await expect(admin.getByTestId('auto-publish')).not.toBeChecked();
});

import { test, expect, type Page } from '@playwright/test';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { PrismaClient, RoleName } from '@hmp/db';
import { seedHandoutAtStatus } from './fixtures/handout';

// v1.4.0 — Admin → People and Departments (docs/plans/departments.md §A, §B, §B2, H6).
//
// Cleanup-by-fixture: every person / programme / department / request this spec makes carries a
// per-run tag and is deleted in `finally`, so the demo database is left as it was.

const prisma = new PrismaClient();
const TAG = `e2e-people-${process.pid}-${Date.now()}`;
const mail = (who: string) => `${who}.${TAG}@hmp.local`;
const DIR = mkdtempSync(join(tmpdir(), 'hmp-people-'));

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

async function deptId(code: string) {
  return (await prisma.department.findUniqueOrThrow({ where: { code } })).id;
}

/** A person straight in the database (optionally able to sign in with "password"). */
async function makePerson(opts: {
  who: string;
  roles: RoleName[];
  departmentCode?: string | null;
  canSignIn?: boolean;
}) {
  const roles = await prisma.role.findMany({ where: { name: { in: opts.roles } } });
  const passwordHash = opts.canSignIn
    ? (await prisma.user.findUniqueOrThrow({ where: { email: 'faculty@hmp.local' } })).passwordHash
    : null;
  return prisma.user.create({
    data: {
      email: mail(opts.who),
      name: `E2E ${opts.who} ${TAG}`,
      passwordHash,
      departmentId: opts.departmentCode ? await deptId(opts.departmentCode) : null,
      roles: { create: roles.map((r) => ({ roleId: r.id })) },
    },
  });
}

/** Remove what this spec made: its requests first (cascades assignments), then its people. */
async function cleanup(requestIds: string[]) {
  if (requestIds.length) {
    // Audit rows keep their request link as SetNull, so remove the ones about these requests too.
    await prisma.auditLog.deleteMany({
      where: { OR: [{ requestId: { in: requestIds } }, { entityId: { in: requestIds } }] },
    });
    await prisma.handoutRequest.deleteMany({ where: { id: { in: requestIds } } });
  }
  const users = await prisma.user.findMany({
    where: { email: { contains: TAG } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  if (!ids.length) return;
  await prisma.requestAssignee.deleteMany({
    where: { OR: [{ userId: { in: ids } }, { assignedById: { in: ids } }] },
  });
  // v1.4.3: an email that could not be sent is in the audit log under its own row id.
  const rows = await prisma.notification.findMany({
    where: { userId: { in: ids } },
    select: { id: true },
  });
  await prisma.auditLog.deleteMany({ where: { entityId: { in: rows.map((r) => r.id) } } });
  await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
  await prisma.auditLog.deleteMany({
    where: { OR: [{ actorId: { in: ids } }, { entityId: { in: ids } }] },
  });
  await prisma.userRole.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

/** Faculty with one finished (APPROVED) handout — teaching history, no open work. */
async function withHistory(who: string) {
  const person = await makePerson({ who, roles: [RoleName.FACULTY], departmentCode: null });
  const seeded = await seedHandoutAtStatus({ status: 'APPROVED', facultyEmail: person.email });
  const req = await prisma.handoutRequest.findUniqueOrThrow({
    where: { id: seeded.requestId },
    select: {
      offering: {
        select: { semester: { select: { programme: { select: { department: true } } } } },
      },
    },
  });
  const dept = req.offering.semester.programme.department;
  expect(
    dept,
    'the fixture course’s programme has a department (seed-departments-demo)',
  ).toBeTruthy();
  return { person, requestId: seeded.requestId, dept: dept! };
}

test.afterAll(async () => {
  await prisma.$disconnect();
});

test('Admin adds a person with roles and a department, then edits them', async ({ page }) => {
  try {
    await signIn(page, 'admin@hmp.local');
    await page.goto('/admin/people/new');
    await page.getByTestId('person-name').fill(`E2E added ${TAG}`);
    await page.getByTestId('person-email').fill(mail('added'));
    await page.getByTestId('person-role-FACULTY').check();
    await page.getByTestId('person-role-SME').check();
    await page.getByTestId('person-department').selectOption({ label: 'CSIS' });
    await page.getByTestId('person-save').click();
    await page.waitForURL(/\/admin\/people$/);

    await page.goto(`/admin/people?q=${encodeURIComponent(mail('added'))}`);
    const row = page.getByTestId('person-row');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('CSIS');
    await expect(row).toContainText('Faculty');
    await expect(row).toContainText('Subject expert');
    // v1.4.3 (H33): ticked by default — the new person got the welcome email (never a password).
    const added = await prisma.user.findUniqueOrThrow({ where: { email: mail('added') } });
    const welcome = await prisma.notification.findFirst({
      where: {
        userId: added.id,
        channel: 'EMAIL',
        meta: { path: ['kind'], equals: 'user.welcome' },
      },
    });
    expect(welcome?.subject).toBe('[HMP] Your HMP account is ready');

    await row.getByTestId('person-edit').click();
    await page.getByTestId('person-name').fill(`E2E renamed ${TAG}`);
    await page.getByTestId('person-save').click();
    await page.waitForURL(/\/admin\/people$/);
    const saved = await prisma.user.findUniqueOrThrow({ where: { email: mail('added') } });
    expect(saved.name).toBe(`E2E renamed ${TAG}`);
    expect(saved.accessVersion).toBeGreaterThan(0);
  } finally {
    await cleanup([]);
  }
});

test('switching someone off asks who takes their open handout, and moves it in the same step', async ({
  page,
}) => {
  const requests: string[] = [];
  try {
    const person = await makePerson({
      who: 'leaver',
      roles: [RoleName.FACULTY],
      departmentCode: 'CSIS',
    });
    const seeded = await seedHandoutAtStatus({ status: 'IN_PROGRESS', facultyEmail: person.email });
    requests.push(seeded.requestId);

    await signIn(page, 'admin@hmp.local');
    await page.goto(`/admin/people/${person.id}`);
    await page.getByTestId('person-active').uncheck();
    await page.getByTestId('person-save').click();
    const impact = page.getByTestId('person-impact');
    await expect(impact).toBeVisible();
    await expect(impact).toContainText(seeded.refNo);
    // Nothing saved yet.
    expect((await prisma.user.findUniqueOrThrow({ where: { id: person.id } })).active).toBe(true);

    const faculty = await prisma.user.findUniqueOrThrow({ where: { email: 'faculty@hmp.local' } });
    await page.getByLabel(`Who takes ${seeded.refNo} over`).selectOption(faculty.id);
    await page.getByTestId('person-impact-confirm').click();
    await page.waitForURL(/\/admin\/people$/);

    expect((await prisma.user.findUniqueOrThrow({ where: { id: person.id } })).active).toBe(false);
    const assignments = await prisma.facultyAssignment.findMany({
      where: { requestId: seeded.requestId },
      select: { facultyId: true, active: true },
    });
    expect(assignments.filter((a) => a.active).map((a) => a.facultyId)).toEqual([faculty.id]);
    expect(assignments.find((a) => a.facultyId === person.id)?.active).toBe(false);
  } finally {
    await cleanup(requests);
  }
});

test('upload: preview suggests a department from past courses; only accepted ones are saved', async ({
  page,
}) => {
  const requests: string[] = [];
  try {
    const { person, requestId, dept } = await withHistory('suggested');
    requests.push(requestId);
    const csv = [
      'Email,Name,Roles,Department',
      `${mail('uploaded')},E2E uploaded ${TAG},FACULTY,EEE`,
      `${person.email},${person.name},FACULTY,`,
    ].join('\n');
    const file = join(DIR, 'people.csv');
    writeFileSync(file, csv);

    await signIn(page, 'admin@hmp.local');
    await page.goto('/admin/people/upload');
    await page.getByTestId('people-file').setInputFiles(file);
    await page.getByTestId('people-preview').click();
    await expect(page.getByTestId('people-preview-table')).toBeVisible();
    const suggestion = page.getByTestId('people-suggestion');
    await expect(suggestion).toHaveCount(1);
    await expect(suggestion).toContainText(`Suggested: ${dept.name} (from 1 past course)`);

    // v1.4.3 (H33): the welcome emails are off by default for an upload; ticking shows how many.
    const welcome = page.getByTestId('people-welcome-tick');
    await expect(welcome).not.toBeChecked();
    await welcome.check();
    await expect(page.getByTestId('people-welcome-count')).toHaveText(
      'Sends a welcome email to 1 person.',
    );
    await welcome.uncheck();
    await expect(page.getByTestId('people-welcome-count')).toHaveCount(0);

    await page.getByTestId('people-accept-all').click();
    await page.getByTestId('people-apply').click();
    await expect(page.getByTestId('people-message')).toContainText(
      'Saved: 1 added, 1 changed (1 suggested department accepted).',
    );
    // Unticked: no welcome email was sent.
    expect(
      await prisma.auditLog.count({
        where: { action: 'user.welcome', after: { path: ['email'], equals: mail('uploaded') } },
      }),
    ).toBe(0);

    const [uploaded, accepted] = await Promise.all([
      prisma.user.findUniqueOrThrow({
        where: { email: mail('uploaded') },
        include: { department: true },
      }),
      prisma.user.findUniqueOrThrow({ where: { id: person.id } }),
    ]);
    expect(uploaded.department?.code).toBe('EEE');
    expect(accepted.departmentId).toBe(dept.id);
  } finally {
    await cleanup(requests);
  }
});

test('upload: a suggestion that is not accepted is not saved', async ({ page }) => {
  const requests: string[] = [];
  try {
    const { person, requestId } = await withHistory('declined');
    requests.push(requestId);
    const file = join(DIR, 'declined.csv');
    writeFileSync(
      file,
      ['email,name,roles,department', `${person.email},Renamed ${TAG},FACULTY,`].join('\n'),
    );
    await signIn(page, 'admin@hmp.local');
    await page.goto('/admin/people/upload');
    await page.getByTestId('people-file').setInputFiles(file);
    await page.getByTestId('people-preview').click();
    await expect(page.getByTestId('people-suggestion')).toHaveCount(1);
    await page.getByTestId('people-apply').click();
    await expect(page.getByTestId('people-message')).toContainText('Saved: 0 added, 1 changed.');
    const after = await prisma.user.findUniqueOrThrow({ where: { id: person.id } });
    expect(after.name).toBe(`Renamed ${TAG}`);
    expect(after.departmentId).toBeNull();
  } finally {
    await cleanup(requests);
  }
});

test('the downloaded list is Excel, with the suggested department and why', async ({ page }) => {
  const requests: string[] = [];
  try {
    const { person, requestId, dept } = await withHistory('download');
    requests.push(requestId);
    await signIn(page, 'admin@hmp.local');
    await page.goto('/admin/people');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: 'Download the list (Excel)' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^hmp-people-\d{4}-\d{2}-\d{2}\.xlsx$/);
    const path = join(DIR, 'people.xlsx');
    await download.saveAs(path);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path);
    const ws = wb.getWorksheet('People')!;
    const header = (ws.getRow(1).values as unknown[]).slice(1);
    expect(header).toEqual(['email', 'name', 'roles', 'department', 'suggested department', 'why']);
    let found: unknown[] | null = null;
    ws.eachRow((row) => {
      const v = (row.values as unknown[]).slice(1);
      if (v[0] === person.email) found = v;
    });
    expect(found).not.toBeNull();
    expect(found![3] ?? '').toBe('');
    expect(found![4]).toBe(dept.code);
    expect(String(found![5])).toContain(`${dept.name} (from 1 past course)`);
    expect(wb.getWorksheet('How to fill')).toBeTruthy();
  } finally {
    await cleanup(requests);
  }
});

test('a role change shows on the person’s next page; switching them off signs them out', async ({
  browser,
}) => {
  try {
    const person = await makePerson({
      who: 'live',
      roles: [RoleName.FACULTY],
      departmentCode: 'CSIS',
      canSignIn: true,
    });
    const them = await (await browser.newContext()).newPage();
    const admin = await (await browser.newContext()).newPage();
    await signIn(them, person.email);
    await them.goto('/sme');
    await expect(them.getByTestId('access-denied')).toBeVisible();

    await signIn(admin, 'admin@hmp.local');
    await admin.goto(`/admin/people/${person.id}`);
    await admin.getByTestId('person-role-SME').check();
    await admin.getByTestId('person-save').click();
    await admin.waitForURL(/\/admin\/people$/);

    // Access is re-read at most every 5 seconds — no sign-out needed.
    await them.waitForTimeout(5_500);
    await them.goto('/sme');
    await expect(them.getByTestId('access-denied')).toHaveCount(0);

    await admin.goto(`/admin/people/${person.id}`);
    await admin.getByTestId('person-active').uncheck();
    await admin.getByTestId('person-save').click();
    await admin.waitForURL(/\/admin\/people$/);

    await them.waitForTimeout(5_500);
    await them.goto('/faculty');
    await them.waitForURL(/\/login\?sso=inactive/);
    await expect(them.getByTestId('sso-notice')).toContainText('switched off');
    await them.context().close();
    await admin.context().close();
  } finally {
    await cleanup([]);
  }
});

test('the Instruction Cell gets People, Upload and Departments — but not Admin accounts or the Admin role', async ({
  page,
}) => {
  try {
    const ic = await makePerson({
      who: 'ic',
      roles: [RoleName.INSTRUCTION_CELL],
      canSignIn: true,
    });
    const faculty = await makePerson({ who: 'icfac', roles: [RoleName.FACULTY] });
    const admin = await makePerson({ who: 'icadmin', roles: [RoleName.ADMIN] });

    await signIn(page, ic.email);
    await page.goto('/ic');
    await expect(page.getByRole('link', { name: 'People', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Departments', exact: true })).toBeVisible();
    await expect(page.getByTestId('department-checks')).toBeVisible();
    // Admin's own area stays closed.
    await page.goto('/admin/people');
    await expect(page.getByTestId('access-denied')).toBeVisible();

    await page.goto(`/ic/people?q=${encodeURIComponent(TAG)}`);
    await expect(page.getByTestId('people-ic-limits')).toBeVisible();
    await expect(page.getByTestId('people-password-accounts')).toHaveCount(0);
    await expect(
      page.getByTestId('person-row').filter({ hasText: admin.email }).getByTestId('person-edit'),
    ).toHaveText('View');

    // A faculty member: the IC sets the department; the Admin role isn't offered.
    await page.goto(`/ic/people/${faculty.id}`);
    await expect(page.getByTestId('person-role-ADMIN')).toHaveCount(0);
    await page.getByTestId('person-department').selectOption({ label: 'CSIS' });
    await page.getByTestId('person-save').click();
    await page.waitForURL(/\/ic\/people$/);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: faculty.id } })).departmentId).toBe(
      await deptId('CSIS'),
    );
    expect(
      await prisma.auditLog.count({ where: { actorId: ic.id, entityId: faculty.id } }),
    ).toBeGreaterThan(0);

    // An Admin account is read-only for the IC.
    await page.goto(`/ic/people/${admin.id}`);
    await expect(page.getByTestId('person-admin-readonly')).toContainText(
      'Only an Admin can change it.',
    );
    await expect(page.getByTestId('person-save')).toHaveCount(0);

    // Upload: an Admin account left as it is passes; giving the Admin role is an error.
    const file = join(DIR, 'ic.csv');
    writeFileSync(
      file,
      [
        'email,name,roles,department',
        `${admin.email},${admin.name},ADMIN,`,
        `${faculty.email},${faculty.name},FACULTY;ADMIN,CSIS`,
        `${mail('icnew')},E2E icnew ${TAG},ADMIN,`,
      ].join('\n'),
    );
    await page.goto('/ic/people/upload');
    await page.getByTestId('people-file').setInputFiles(file);
    await page.getByTestId('people-preview').click();
    const table = page.getByTestId('people-preview-table');
    await expect(table).toBeVisible();
    await expect(table.locator('tr[data-status="unchanged"]')).toContainText(admin.email);
    await expect(table.locator('tr[data-status="error"]')).toHaveCount(2);
    await expect(table.locator('tr[data-status="error"]').first()).toContainText(
      'Only an Admin can give the Admin role.',
    );
    // Nothing can be applied while a row is in error (the server refuses it too).
    await expect(page.getByTestId('people-apply')).toBeDisabled();
    expect(await prisma.user.count({ where: { email: mail('icnew') } })).toBe(0);

    // Departments: open to the IC; no delete anywhere.
    await page.goto('/ic/departments');
    await expect(page.getByTestId('department-row').filter({ hasText: 'CSIS' })).toBeVisible();
    await expect(page.getByRole('button', { name: /delete/i })).toHaveCount(0);
  } finally {
    await cleanup([]);
  }
});

test('Admin → Departments: add a department; tag a programme', async ({ page }) => {
  const code = `E2E${(Date.now() % 100000).toString(36).toUpperCase()}`;
  const programme = await prisma.programme.create({
    data: { code: `E2E-PROG-${TAG}`, name: `E2E programme ${TAG}` },
  });
  try {
    await signIn(page, 'admin@hmp.local');
    await page.goto('/admin');
    await expect(page.getByTestId('department-checks')).toBeVisible();

    await page.goto('/admin/departments');
    await expect(page.getByTestId('department-row').filter({ hasText: 'CSIS' })).toBeVisible();
    await page.getByTestId('dept-add').click();
    await page.getByTestId('dept-code').fill(code);
    await page.getByTestId('dept-name').fill(`E2E department ${TAG}`);
    await page.getByTestId('dept-save').click();
    await expect(page.getByTestId('department-row').filter({ hasText: code })).toBeVisible();

    const row = page.getByTestId('programme-row').filter({ hasText: programme.code });
    await row.getByTestId('dept-select-programme').selectOption({ label: 'EEE' });
    await expect(row).toContainText('Saved');
    const after = await prisma.programme.findUniqueOrThrow({ where: { id: programme.id } });
    expect(after.departmentId).toBe(await deptId('EEE'));
  } finally {
    const dept = await prisma.department.findUnique({ where: { code } });
    await prisma.programme.delete({ where: { id: programme.id } });
    await prisma.auditLog.deleteMany({
      where: { entityId: { in: [programme.id, ...(dept ? [dept.id] : [])] } },
    });
    if (dept) await prisma.department.delete({ where: { id: dept.id } });
  }
});

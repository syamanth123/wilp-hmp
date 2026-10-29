import { test, expect, type Page } from '@playwright/test';
import { prisma } from '@hmp/db';
import { seedHandoutAtStatus, cleanupTestHandouts } from './fixtures/handout';

// Bulk tools for HOG and PC, end to end through the new "Bulk tools" menu:
// each role's hub lists its tools with a working template download, and each
// tool processes a small CSV for real:
//   HOG  allocate (upload)        REQUESTED   → ALLOCATED
//   PC   confirm allocations      ALLOCATED   → ASSIGNED
//   PC   review handouts          SUBMITTED   → UNDER_REVIEW
//   HOG  review handouts          UNDER_REVIEW → APPROVED
// plus: an empty upload is refused with a plain message.

async function signIn(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

async function upload(page: Page, csv: string) {
  await page
    .getByTestId('bulk-csv-file')
    .setInputFiles({ name: 'bulk.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
  await page.getByTestId('bulk-process-button').click();
}

/** Opens the role's hub from its menu and checks every card's template. */
async function openHub(page: Page, home: '/hog' | '/pc', cardIds: string[], headers: string[]) {
  await page.goto(home);
  await page.getByRole('link', { name: 'Bulk tools' }).first().click();
  await expect(page).toHaveURL(new RegExp(`${home}/bulk$`));
  await expect(page.getByTestId('back-to-dashboard')).toHaveAttribute('href', home);
  for (let i = 0; i < cardIds.length; i++) {
    const card = page.getByTestId(cardIds[i]!);
    await expect(card).toBeVisible();
    const href = await card.getByRole('link', { name: 'Download template' }).getAttribute('href');
    const res = await page.request.get(href!);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/csv');
    expect((await res.text()).split('\n')[0]).toBe(headers[i]);
  }
}

async function statusOf(refNo: string) {
  return (
    await prisma.handoutRequest.findUniqueOrThrow({ where: { refNo }, select: { status: true } })
  ).status;
}

async function setStatus(requestId: string, status: 'SUBMITTED' | 'UNDER_REVIEW') {
  await prisma.handoutRequest.update({ where: { id: requestId }, data: { status } });
  await prisma.handout.update({ where: { requestId }, data: { status } });
}

// Fixture handouts are removed afterwards; the IC-created request stays, like
// in the other end-to-end flows (CI runs on a fresh database).
test.afterAll(async () => {
  await cleanupTestHandouts();
});

test('HOG and PC bulk tools work from the menu, each with a small CSV', async ({ page }) => {
  test.setTimeout(180_000);

  // A fresh request waiting for allocation (IC creates it the normal way).
  await signIn(page, 'ic@hmp.local');
  await page.goto('/ic/requests/new');
  await page.getByLabel('Programme').selectOption({ index: 1 });
  await page.getByLabel('Semester').selectOption({ index: 1 });
  await page.getByLabel('Course').selectOption({ index: 1 });
  await page.getByRole('button', { name: /create request/i }).click();
  await page.waitForURL(/\/ic\/requests\/c[a-z0-9]{20,}/i);
  const createdRequestId = page.url().split('/').pop()!;
  const { refNo: newRef } = await prisma.handoutRequest.findUniqueOrThrow({
    where: { id: createdRequestId },
    select: { refNo: true },
  });

  // HOG: hub → allocate tool → 1-row CSV.
  await signIn(page, 'hog@hmp.local');
  await openHub(
    page,
    '/hog',
    ['bulk-tool-hog-allocate', 'bulk-tool-hog-review'],
    ['request_reference,faculty_emails,sme_email', 'request_reference,action,comment'],
  );
  await page.getByTestId('bulk-tool-hog-allocate').getByRole('link', { name: 'Open' }).click();
  await expect(page.getByTestId('back-to-dashboard')).toBeVisible();
  await upload(
    page,
    `request_reference,faculty_emails,sme_email\n${newRef},faculty@hmp.local,sme@hmp.local`,
  );
  await expect(page.getByTestId('bulk-success')).toContainText(/Allocated 1 request/i, {
    timeout: 15_000,
  });
  expect(await statusOf(newRef)).toBe('ALLOCATED');

  // PC: hub → confirm allocations → 1-row CSV.
  await signIn(page, 'pc@hmp.local');
  await openHub(
    page,
    '/pc',
    ['bulk-tool-pc-allocation', 'bulk-tool-pc-review'],
    ['request_reference,action,comment', 'request_reference,action,comment'],
  );
  await page.getByTestId('bulk-tool-pc-allocation').getByRole('link', { name: 'Open' }).click();
  await upload(page, `request_reference,action,comment\n${newRef},pc_confirm_allocation,`);
  await expect(page.getByTestId('bulk-success')).toContainText(/Applied 1 action/i, {
    timeout: 15_000,
  });
  expect(await statusOf(newRef)).toBe('ASSIGNED');

  // PC: review handouts → approve a submitted handout.
  const submitted = await seedHandoutAtStatus({ status: 'SME_REVIEW' });
  await setStatus(submitted.requestId, 'SUBMITTED');
  await page.goto('/pc/bulk');
  await page.getByTestId('bulk-tool-pc-review').getByRole('link', { name: 'Open' }).click();

  // An empty (header-only) file is refused in plain words, nothing applied.
  await upload(page, 'request_reference,action,comment\n');
  await expect(page.getByTestId('bulk-rejected')).toContainText(/The file has no rows/i, {
    timeout: 15_000,
  });

  await upload(page, `request_reference,action,comment\n${submitted.refNo},pc_approve,`);
  await expect(page.getByTestId('bulk-success')).toContainText(/Applied 1 action/i, {
    timeout: 15_000,
  });
  expect(await statusOf(submitted.refNo)).toBe('UNDER_REVIEW');

  // HOG: review handouts → final approval of the same handout.
  await signIn(page, 'hog@hmp.local');
  await page.goto('/hog/bulk');
  await page.getByTestId('bulk-tool-hog-review').getByRole('link', { name: 'Open' }).click();
  await upload(page, `request_reference,action,comment\n${submitted.refNo},hog_final_approve,`);
  await expect(page.getByTestId('bulk-success')).toContainText(/Applied 1 action/i, {
    timeout: 15_000,
  });
  expect(await statusOf(submitted.refNo)).toBe('APPROVED');
});

test('bulk templates are refused to roles that cannot use them', async ({ page }) => {
  await signIn(page, 'faculty@hmp.local');
  for (const href of [
    '/hog/requests/bulk-allocate/template',
    '/hog/bulk-review/template',
    '/pc/allocation-review/template',
    '/pc/bulk-review/template',
  ]) {
    const res = await page.request.get(href);
    expect(res.status(), href).toBe(403);
  }
});

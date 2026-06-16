import { test, expect, type Page } from '@playwright/test';
import { prisma, HandoutStatus, ApprovalStage, ApprovalDecision, FacultyType } from '@hmp/db';
import { cleanupTestHandouts } from './fixtures/handout';

// Prompt 22: PC allocation reject UI flow. PC opens an ALLOCATED request,
// rejects the allocation with a reason → status back to REQUESTED; HOG then
// sees the reason on the request. Live-runnable (no MinIO/Redis). Seeds an
// ALLOCATED request inline (the shared fixture only covers ASSIGNED+), using the
// HMP-8888- sentinel prefix so cleanupTestHandouts() tears it down.

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

async function seedAllocated(): Promise<{ id: string; refNo: string }> {
  const [faculty, sme, ic, offering] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { email: 'faculty@hmp.local' }, select: { id: true } }),
    prisma.user.findUniqueOrThrow({ where: { email: 'sme@hmp.local' }, select: { id: true } }),
    prisma.user.findUniqueOrThrow({ where: { email: 'ic@hmp.local' }, select: { id: true } }),
    prisma.courseOffering.findFirstOrThrow({ orderBy: { createdAt: 'asc' }, select: { id: true } }),
  ]);
  const refNo = `HMP-8888-${process.hrtime.bigint().toString(36)}`;
  const req = await prisma.handoutRequest.create({
    data: {
      refNo,
      courseOfferingId: offering.id,
      initiatedById: ic.id,
      status: HandoutStatus.ALLOCATED,
      handout: { create: { status: HandoutStatus.ALLOCATED } },
      assignments: {
        create: { facultyId: faculty.id, facultyType: FacultyType.ON_CAMPUS, active: true },
      },
      smeAssignment: { create: { smeUserId: sme.id, assignedById: ic.id } },
      approvals: {
        create: {
          stage: ApprovalStage.HOG_REVIEW,
          decision: ApprovalDecision.APPROVED,
          reviewerId: ic.id,
          decidedAt: new Date(),
        },
      },
    },
    select: { id: true, refNo: true },
  });
  return req;
}

test.describe('PC allocation reject', () => {
  let requestId = '';

  test.afterEach(async () => {
    await cleanupTestHandouts();
  });

  test('PC rejects an allocation → REQUESTED + HOG sees the reason', async ({ page, browser }) => {
    ({ id: requestId } = await seedAllocated());

    // PC rejects with a reason.
    await signIn(page, 'pc@hmp.local');
    await page.goto(`/pc/requests/${requestId}`);
    await expect(page.getByTestId('reject-allocation-btn')).toBeVisible();
    await page
      .getByTestId('assignment-comments')
      .fill('SME lacks expertise in distributed systems for this course');
    await page.getByTestId('reject-allocation-btn').click();
    // A successful reject moves the request to REQUESTED; revalidatePath then
    // re-renders this (force-dynamic) page, and the assignment panel — gated on
    // status === ALLOCATED — unmounts. So the panel's transient success line is
    // destroyed by the re-render; the stable observable is the panel detaching.
    // (On a server-side failure the panel stays mounted and shows an error.)
    await expect(page.getByTestId('reject-allocation-btn')).toHaveCount(0);

    // DB moved back to REQUESTED + SME assignment cleared.
    const after = await prisma.handoutRequest.findUniqueOrThrow({
      where: { id: requestId },
      select: { status: true },
    });
    expect(after.status).toBe(HandoutStatus.REQUESTED);
    expect(await prisma.smeAssignment.count({ where: { requestId } })).toBe(0);

    // HOG sees the reject reason on the request detail (re-allocate informed).
    const hogCtx = await browser.newContext();
    const hogPage = await hogCtx.newPage();
    try {
      await signIn(hogPage, 'hog@hmp.local');
      await hogPage.goto(`/hog/requests/${requestId}`);
      await expect(hogPage.getByText(/Previous allocation rejected by PC/i)).toBeVisible();
      // The banner's unique phrasing carries the reason (avoid matching the
      // course info, which may itself mention "distributed systems").
      await expect(hogPage.getByText(/Re-allocate addressing this feedback/i)).toBeVisible();
    } finally {
      await hogCtx.close();
    }
  });

  test('reject requires a comment (empty → inline error, no transition)', async ({ page }) => {
    ({ id: requestId } = await seedAllocated());
    await signIn(page, 'pc@hmp.local');
    await page.goto(`/pc/requests/${requestId}`);
    await page.getByTestId('reject-allocation-btn').click(); // no comment
    await expect(page.getByTestId('assignment-error')).toContainText(/reject reason is required/i);
    const after = await prisma.handoutRequest.findUniqueOrThrow({
      where: { id: requestId },
      select: { status: true },
    });
    expect(after.status).toBe(HandoutStatus.ALLOCATED); // unchanged
  });
});

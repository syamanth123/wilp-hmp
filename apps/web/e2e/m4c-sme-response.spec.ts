import { test, expect, type Page } from '@playwright/test';
import {
  prisma,
  SmeNominationStatus,
  SmeNominationStatus as Status,
} from '@hmp/db';
import { seedHandoutAtStatus } from './fixtures/handout';

// m4c — outbound side of the SME nomination flow (Prompt 7).
// PC has already nominated; SME logs in, accepts, comments, marks complete.
// This spec exercises the full SME-side wire: dashboard counter → list →
// detail → accept → comment → mark-complete. Persistent-state assertions
// only (status badges + DB rows + AuditLog entries) — never transient
// success-message text.
//
// Cleanup strategy: scoped to *this spec's* requestId rather than the
// prefix-sweep cleanupTestHandouts(). Under current playwright config
// (workers:1, fullyParallel:false) the prefix sweep would be fine, but
// scoping by requestId is defensive against future parallelism and makes
// the spec's data ownership explicit. The delete cascades through
// SmeNomination, Comment, AuditLog, Handout, HandoutVersion, Approval,
// FacultyAssignment via Prisma schema `onDelete: Cascade`.

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

async function signOut(page: Page) {
  await page.goto('/api/auth/signout');
  await page.getByRole('button', { name: /sign out/i }).click().catch(() => {});
  await page.context().clearCookies();
}

test.describe('SME response (outbound)', () => {
  let requestId: string;
  let refNo: string;
  let nominationId: string;

  test.beforeEach(async () => {
    // IN_PROGRESS so a handout + version exist and comments are possible.
    // (Fixture supports IN_PROGRESS since Prompt 7 — see fixtures/handout.ts.)
    const seeded = await seedHandoutAtStatus({ status: 'IN_PROGRESS' });
    requestId = seeded.requestId;
    refNo = seeded.refNo;

    // Resolve sme + pc user ids by email (the seeded users from db:seed).
    const [sme, pc] = await Promise.all([
      prisma.user.findUniqueOrThrow({
        where: { email: 'sme@hmp.local' },
        select: { id: true },
      }),
      prisma.user.findUniqueOrThrow({
        where: { email: 'pc@hmp.local' },
        select: { id: true },
      }),
    ]);

    const nom = await prisma.smeNomination.create({
      data: {
        requestId,
        smeUserId: sme.id,
        nominatedById: pc.id,
        topic: 'Industry perspective on architectures',
        notes: 'PC context: please focus on Part B microservices section.',
        status: SmeNominationStatus.PENDING,
      },
      select: { id: true },
    });
    nominationId = nom.id;
  });

  test.afterEach(async () => {
    // Scoped delete — cascades through every dependent row this spec created.
    // See cleanup-strategy comment at the top of this file for rationale.
    if (requestId) {
      await prisma.handoutRequest
        .delete({ where: { id: requestId } })
        .catch(() => undefined);
    }
  });

  test('SME accepts → comments → marks complete; faculty sees the advisory entry', async ({
    page,
  }) => {
    // ── SME side ────────────────────────────────────────────────────────────
    await signIn(page, 'sme@hmp.local');

    // Dashboard shows the pending nomination in "Recent pending nominations".
    // Scope by our seeded refNo (unique per spec run) — other seed-baseline
    // or leftover nominations may exist in the DB and would otherwise match
    // by topic alone.
    await expect(page.getByRole('heading', { name: /recent pending nominations/i })).toBeVisible();
    const pendingRow = page.getByRole('listitem').filter({ hasText: refNo });
    await expect(pendingRow).toBeVisible();

    // List page — default tab is pending, our nomination is there.
    await page.goto('/sme/nominations');
    await expect(page.getByRole('cell', { name: refNo })).toBeVisible();

    // Detail page — open via Link.
    await page.goto(`/sme/nominations/${nominationId}`);
    await expect(page.getByRole('heading', { name: /your response/i })).toBeVisible();
    // Status badge: PENDING.
    await expect(page.getByText('PENDING', { exact: true }).first()).toBeVisible();

    // Accept.
    await page.getByRole('button', { name: /accept nomination/i }).click();
    // Persistent post-accept signal: status badge flips to ACCEPTED. This is
    // server-rendered after revalidate, so it's durable across refreshes.
    await expect(page.getByText('ACCEPTED', { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });

    // DB: SmeNomination row now ACCEPTED, AuditLog row written.
    {
      const row = await prisma.smeNomination.findUnique({
        where: { id: nominationId },
        select: { status: true, respondedAt: true },
      });
      expect(row?.status).toBe(Status.ACCEPTED);
      expect(row?.respondedAt).not.toBeNull();

      const audit = await prisma.auditLog.findFirst({
        where: { requestId, action: 'sme.accepted', entityId: nominationId },
        select: { actorId: true },
      });
      expect(audit).not.toBeNull();
    }

    // Add a comment — uses the existing CommentForm wired to addCommentAction.
    await page
      .getByLabel(/add a comment/i)
      .fill('Recommend adding a case study on microservices architectures.');
    await page.getByRole('button', { name: /post comment/i }).click();

    // Persistent signal: the comment appears in the thread by its body text.
    await expect(
      page.getByText('Recommend adding a case study on microservices architectures.'),
    ).toBeVisible({ timeout: 30_000 });

    // Mark complete — only enabled after the comment exists (the UI hint),
    // but the server enforces the same gate independently.
    await page.getByRole('button', { name: /mark nomination complete/i }).click();
    await expect(page.getByText('COMPLETED', { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });

    // DB: COMPLETED + AuditLog row.
    {
      const row = await prisma.smeNomination.findUnique({
        where: { id: nominationId },
        select: { status: true, completedAt: true },
      });
      expect(row?.status).toBe(Status.COMPLETED);
      expect(row?.completedAt).not.toBeNull();

      const audit = await prisma.auditLog.findFirst({
        where: { requestId, action: 'sme.completed', entityId: nominationId },
        select: { actorId: true },
      });
      expect(audit).not.toBeNull();
    }

    // ── Faculty side ────────────────────────────────────────────────────────
    // Faculty open the assignment and see the completed SME in the advisory
    // panel above the comment thread. Same browser context — switching user
    // requires a fresh sign-in via the login flow; signOut clears cookies.
    await signOut(page);
    await signIn(page, 'faculty@hmp.local');
    await page.goto(`/faculty/assignments/${requestId}`);

    await expect(page.getByRole('heading', { name: /smes advising on this handout/i })).toBeVisible();
    // Scope by "View comments" — that anchor link is only rendered by
    // SmeAdvisoryPanel, never by the notification list in the AppShell. This
    // disambiguates from notification-bell entries that share text content
    // ("Dr. Sneha Mehta" + "COMPLETED") with our target row.
    const facultyRow = page
      .getByRole('listitem')
      .filter({ has: page.getByRole('link', { name: 'View comments' }) })
      .filter({ hasText: 'Dr. Sneha Mehta' })
      .filter({ hasText: 'COMPLETED' });
    await expect(facultyRow).toBeVisible();
    await expect(facultyRow.getByText('Industry perspective on architectures')).toBeVisible();
  });
});

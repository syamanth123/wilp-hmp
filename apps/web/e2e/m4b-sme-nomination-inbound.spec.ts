import { test, expect, type Page } from '@playwright/test';
import { prisma, SmeNominationStatus } from '@hmp/db';
import { seedHandoutAtStatus, cleanupTestHandouts } from './fixtures/handout';

// m4b — inbound side of SME nomination (Prompt 6).
// PC user opens a handout in ASSIGNED status, picks Dr. Sneha Mehta from the
// SME dropdown, fills topic + notes, and submits. This spec only covers the
// form-submit wire end-to-end: panel renders, dropdown is populated, submit
// returns success, the new nomination row shows up in the list with PENDING
// badge, and the DB has both the SmeNomination row and its AuditLog entry.
//
// Style notes mirroring m6a-publish.spec.ts:
//   - No `waitForLoadState('networkidle')` — the page opens a long-lived SSE
//     connection so 'networkidle' never fires. `expect.toBeVisible` auto-polls.
//   - Persistent state only — assertions land on UI that survives a refresh,
//     never on transient toasts or button-disabled states.
//   - DB assertions are scoped by requestId so they're isolated even if a
//     parallel test happened to seed the same SME elsewhere (it won't —
//     fullyParallel: false — but the scope makes the intent explicit).

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

test.describe('PC nominates SME (inbound)', () => {
  let requestId: string;

  test.beforeEach(async () => {
    const { requestId: id } = await seedHandoutAtStatus({ status: 'ASSIGNED' });
    requestId = id;
  });

  test.afterEach(async () => {
    await cleanupTestHandouts();
  });

  test('PC submits a nomination and sees it land in the list with PENDING badge', async ({
    page,
  }) => {
    await signIn(page, 'pc@hmp.local');
    await page.goto(`/pc/requests/${requestId}`);

    // Panel + form are visible. The form only renders when the request status
    // accepts nominations (ASSIGNED is in NOMINATION_ALLOWED_STATUSES) AND
    // there is at least one active SME user — both true here.
    await expect(page.getByRole('heading', { name: /sme nominations/i })).toBeVisible();
    await expect(page.getByLabel('SME')).toBeVisible();

    // The seeded SME (Dr. Sneha Mehta — see packages/db/prisma/seed.ts) must be
    // in the dropdown. Match by the full option label rendered by the panel
    // (`${name} — ${email}` — note the em dash, not a hyphen).
    await page
      .getByLabel('SME')
      .selectOption({ label: 'Dr. Sneha Mehta — sme@hmp.local' });
    await page.getByLabel(/^Topic/).fill('Industry perspective on architectures');
    await page.getByLabel(/^Notes/).fill('Looking for an industry voice on Part B section 3.');

    await page.getByRole('button', { name: /nominate sme/i }).click();

    // Persistent post-action signal: a new <li> appears in the nominations
    // list bearing the SME's name + a PENDING badge. This survives any page
    // refresh because it's server-rendered from the DB. Single durable
    // assertion — no toast / no button-state polling.
    const newRow = page
      .getByRole('listitem')
      .filter({ hasText: /Dr\. Sneha Mehta/ })
      .filter({ hasText: 'PENDING' });
    await expect(newRow).toBeVisible({ timeout: 30_000 });
    await expect(newRow.getByText('Industry perspective on architectures')).toBeVisible();

    // DB assertions — scoped by requestId. Confirms the server action wrote
    // both the nomination row AND the audit row in the same transaction.
    const nomination = await prisma.smeNomination.findFirst({
      where: { requestId },
      select: {
        id: true,
        status: true,
        topic: true,
        notes: true,
        smeUser: { select: { email: true } },
      },
    });
    expect(nomination).not.toBeNull();
    expect(nomination!.status).toBe(SmeNominationStatus.PENDING);
    expect(nomination!.topic).toBe('Industry perspective on architectures');
    expect(nomination!.notes).toBe('Looking for an industry voice on Part B section 3.');
    expect(nomination!.smeUser.email).toBe('sme@hmp.local');

    const audit = await prisma.auditLog.findFirst({
      where: { requestId, action: 'sme.nominated', entityId: nomination!.id },
      select: { actorId: true, entity: true, before: true, after: true },
    });
    expect(audit).not.toBeNull();
    expect(audit!.entity).toBe('SmeNomination');
    expect(audit!.before).toBeNull();
    expect(audit!.after).toMatchObject({
      smeUserId: expect.any(String),
      topic: 'Industry perspective on architectures',
    });
  });
});

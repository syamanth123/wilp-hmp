import { test, expect, type Page } from '@playwright/test';
import {
  prisma,
  HandoutStatus,
  ApprovalStage,
  ApprovalDecision,
  NotificationChannel,
} from '@hmp/db';
import { seedHandoutAtStatus } from './fixtures/handout';

// m4 — the SME APPROVAL-GATE showcase (Prompt 12-b). Replaces the retired
// advisory loop (old m4b/m4c/m4d). The SME is now an approval gate between
// faculty submit and PC review:
//   faculty submit → SME_REVIEW → SME approves (→ PC queue) OR
//                                 SME requests changes (→ faculty rework).
//
// Each test seeds a fresh handout already in SME_REVIEW (with an SmeAssignment
// to sme@hmp.local) via the fixture, then drives the SME decision through the
// real UI and verifies the downstream state + the recipient-facing email.
//
// Email strategy (inherited from the old m4d): the email-content assertions are
// gated behind a Mailhog reachability probe. The FLOW + DB + UI assertions
// ALWAYS RUN; only the inbox checks are conditional — full coverage on a
// no-Mailhog dev box, full-coverage-PLUS-email where Mailhog is provisioned.

const MAILHOG_BASE = process.env.MAILHOG_URL ?? 'http://localhost:8025';
const REVERT_COMMENT = 'Please expand the evaluative-components rubric before resubmitting.';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

async function signOut(page: Page) {
  await page.context().clearCookies();
}

// ── Mailhog helpers (verbatim from the retired m4d) ──────────────────────────

interface MailhogMessage {
  Content: { Headers: { Subject?: string[]; To?: string[] }; Body?: string };
}

/**
 * Decodes RFC 2047 MIME "encoded-words" in a header value. nodemailer encodes
 * a Subject as `=?UTF-8?Q?...?=` (or `?B?` base64) whenever it contains a
 * non-ASCII char (our course title has an em dash). Every real mail client
 * decodes this transparently; the test must too, to match the human subject.
 */
function decodeMimeWords(input: string): string {
  const joined = input.replace(/\?=\s+=\?/g, '?==?');
  return joined.replace(/=\?[^?]+\?([QqBb])\?([^?]*)\?=/g, (_full, enc: string, text: string) => {
    if (enc.toUpperCase() === 'B') {
      return Buffer.from(text, 'base64').toString('utf8');
    }
    const bytes: number[] = [];
    for (let i = 0; i < text.length; i++) {
      const c = text[i]!;
      if (c === '_') {
        bytes.push(0x20);
      } else if (c === '=' && /^[0-9A-Fa-f]{2}$/.test(text.slice(i + 1, i + 3))) {
        bytes.push(parseInt(text.slice(i + 1, i + 3), 16));
        i += 2;
      } else {
        bytes.push(c.charCodeAt(0));
      }
    }
    return Buffer.from(bytes).toString('utf8');
  });
}

function logCapturedEmail(label: string, m: MailhogMessage): void {
  const subject = decodeMimeWords(m.Content.Headers.Subject?.[0] ?? '(no subject)');
  const to = (m.Content.Headers.To ?? []).join(', ');
  const body = (m.Content.Body ?? '').replace(/=\r?\n/g, '').slice(0, 600);
  console.log(
    `\n=== CAPTURED EMAIL [${label}] ===\nTo: ${to}\nSubject: ${subject}\nBody: ${body}\n=== END EMAIL ===\n`,
  );
}

async function mailhogReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${MAILHOG_BASE}/api/v2/messages?limit=1`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function clearMailhog(): Promise<void> {
  try {
    await fetch(`${MAILHOG_BASE}/api/v1/messages`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // best-effort — if Mailhog isn't up there's nothing to clear
  }
}

async function waitForEmail(
  subjectRe: RegExp,
  recipient: string,
  timeoutMs = 15_000,
): Promise<MailhogMessage> {
  const deadline = Date.now() + timeoutMs;
  let last: MailhogMessage[] = [];
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILHOG_BASE}/api/v2/messages?limit=50`);
    const json = (await res.json()) as { items: MailhogMessage[] };
    last = json.items ?? [];
    const match = last.find((m) => {
      const subject = decodeMimeWords(m.Content.Headers.Subject?.[0] ?? '');
      const to = (m.Content.Headers.To ?? []).join(',');
      return subjectRe.test(subject) && to.includes(recipient);
    });
    if (match) return match;
    await new Promise((r) => setTimeout(r, 500));
  }
  const seen = last.map((m) => decodeMimeWords(m.Content.Headers.Subject?.[0] ?? '')).join(' | ');
  throw new Error(
    `No Mailhog message matching ${subjectRe} → ${recipient} within ${timeoutMs}ms. Seen: [${seen}]`,
  );
}

/**
 * The set of recipient emails that received an IN_PORTAL Notification for a
 * given workflow event on this request. Asserts the notification SIDE EFFECT
 * of the SME actions — the gap the unit layer couldn't see (audit §6 Risk 7).
 * In-portal rows are written synchronously here (Redis down → dispatchOrEnqueue
 * runs inline), independent of whether SMTP/Mailhog is up.
 */
async function inPortalRecipients(reqId: string, event: string): Promise<Set<string>> {
  const rows = await prisma.notification.findMany({
    where: { channel: NotificationChannel.IN_PORTAL, meta: { path: ['requestId'], equals: reqId } },
    select: { meta: true, user: { select: { email: true } } },
  });
  return new Set(
    rows
      .filter((r) => (r.meta as { event?: string } | null)?.event === event)
      .map((r) => r.user.email),
  );
}

// ── Spec ─────────────────────────────────────────────────────────────────────

test.describe('SME approval gate — multi-role loop', () => {
  let requestId: string;
  let refNo: string;
  let mailhogUp = false;

  test.beforeEach(async () => {
    mailhogUp = await mailhogReachable();
    if (mailhogUp) await clearMailhog();

    // A handout already submitted for SME review, with sme@hmp.local assigned.
    const seeded = await seedHandoutAtStatus({ status: 'SME_REVIEW' });
    requestId = seeded.requestId;
    refNo = seeded.refNo;
  });

  test.afterEach(async () => {
    if (mailhogUp) await clearMailhog();
    // Cascades through SmeAssignment, Approval, Comment, Handout, etc.
    if (requestId) {
      await prisma.handoutRequest.delete({ where: { id: requestId } }).catch(() => undefined);
    }
  });

  test('SME requests changes → faculty sees the revert banner (+ email)', async ({ page }) => {
    // ── SME opens the queue, finds the handout, requests changes ──────────────
    await signIn(page, 'sme@hmp.local');
    await page.goto('/sme/review');
    await expect(page.getByTestId(`sme-review-row-${requestId}`)).toBeVisible();

    await page.goto(`/sme/review/${requestId}`);
    await expect(page.getByTestId('sme-approve-button')).toBeVisible();
    await page.getByTestId('sme-revert-comment').fill(REVERT_COMMENT);
    await page.getByTestId('sme-revert-button').click();
    // After revert + revalidatePath, the server component re-renders with the
    // new status (no longer SME_REVIEW), so the panel is replaced by the
    // read-only note. Assert that PERSISTENT state — the panel's transient
    // client-side success message gets swapped out by the re-render before
    // Playwright can observe it (the m5 lesson: assert persistent state, not a
    // transient success banner).
    await expect(page.getByTestId('sme-review-readonly')).toContainText('REWORK_REQUESTED', {
      timeout: 15_000,
    });

    // ── DB: REWORK_REQUESTED + an SME_REVIEW/REWORK approval carrying the note ─
    await expect
      .poll(
        async () => {
          const r = await prisma.handoutRequest.findUnique({
            where: { id: requestId },
            select: { status: true },
          });
          return r?.status;
        },
        { timeout: 10_000 },
      )
      .toBe(HandoutStatus.REWORK_REQUESTED);
    const approval = await prisma.approval.findFirst({
      where: { requestId, stage: ApprovalStage.SME_REVIEW, decision: ApprovalDecision.REWORK },
      select: { comments: true },
    });
    expect(approval?.comments).toBe(REVERT_COMMENT);

    // ── Notification routing (the 12-b fix): SME_REVERTED notifies faculty + IC.
    const revertRecipients = await inPortalRecipients(requestId, 'SME_REVERTED');
    expect(revertRecipients.has('faculty@hmp.local')).toBe(true);
    expect(revertRecipients.has('ic@hmp.local')).toBe(true);

    // ── Email: faculty is told the SME requested changes (gated) ──────────────
    if (mailhogUp) {
      const email = await waitForEmail(
        new RegExp(`^SME requested changes: ${refNo}`),
        'faculty@hmp.local',
      );
      logCapturedEmail('sme_reverted → faculty', email);
      expect(decodeMimeWords(email.Content.Headers.Subject?.[0] ?? '')).not.toContain('{{');
      expect((email.Content.Body ?? '').replace(/=\r?\n/g, '')).not.toContain('{{');
    }

    // ── Faculty sees the SME revert banner + the SME's comment ────────────────
    await signOut(page);
    await signIn(page, 'faculty@hmp.local');
    await page.goto(`/faculty/assignments/${requestId}`);
    const banner = page.getByTestId('revert-banner-sme');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/your sme requested changes/i);
    await expect(banner).toContainText(REVERT_COMMENT);
  });

  test('SME approves → handout moves to the PC review queue (+ email)', async ({ page }) => {
    // ── SME approves ──────────────────────────────────────────────────────────
    await signIn(page, 'sme@hmp.local');
    await page.goto(`/sme/review/${requestId}`);
    await page.getByTestId('sme-approve-button').click();
    // Persistent post-revalidate state (panel replaced by the read-only note,
    // now showing the SUBMITTED status) — not the transient success banner.
    // See the m5 lesson note in the revert test above.
    await expect(page.getByTestId('sme-review-readonly')).toContainText('SUBMITTED', {
      timeout: 15_000,
    });

    // ── DB: SUBMITTED (PC's queue) + an SME_REVIEW/APPROVED approval ──────────
    await expect
      .poll(
        async () => {
          const r = await prisma.handoutRequest.findUnique({
            where: { id: requestId },
            select: { status: true },
          });
          return r?.status;
        },
        { timeout: 10_000 },
      )
      .toBe(HandoutStatus.SUBMITTED);
    const approval = await prisma.approval.findFirst({
      where: { requestId, stage: ApprovalStage.SME_REVIEW, decision: ApprovalDecision.APPROVED },
      select: { id: true },
    });
    expect(approval).not.toBeNull();

    // ── Notification routing (the 12-b fix): SME_APPROVED notifies faculty + IC
    // + PC (PC inherits the "work arrived" ping — see notification-templates.ts).
    const approveRecipients = await inPortalRecipients(requestId, 'SME_APPROVED');
    expect(approveRecipients.has('faculty@hmp.local')).toBe(true);
    expect(approveRecipients.has('ic@hmp.local')).toBe(true);
    expect(approveRecipients.has('pc@hmp.local')).toBe(true);

    // ── Email: faculty + PC are told it cleared the SME gate (gated) ──────────
    if (mailhogUp) {
      const facultyEmail = await waitForEmail(
        new RegExp(`^SME approved: ${refNo}`),
        'faculty@hmp.local',
      );
      logCapturedEmail('sme_approved → faculty', facultyEmail);
      expect(decodeMimeWords(facultyEmail.Content.Headers.Subject?.[0] ?? '')).not.toContain('{{');
      const pcEmail = await waitForEmail(new RegExp(`^SME approved: ${refNo}`), 'pc@hmp.local');
      logCapturedEmail('sme_approved → pc', pcEmail);
    }

    // ── PC now sees the submission waiting for review ─────────────────────────
    await signOut(page);
    await signIn(page, 'pc@hmp.local');
    await page.goto(`/pc/requests/${requestId}`);
    await expect(page.getByRole('heading', { name: /review submission/i })).toBeVisible();
    await expect(page.getByText(/^Submitted$/).first()).toBeVisible();
  });

  test('faculty submit routes through the SME gate → SME_REVIEW (+ notifies the SME)', async ({
    page,
  }) => {
    // The beforeEach seeds an SME_REVIEW request; this flow instead needs an
    // IN_PROGRESS handout WITH an SME assigned, so it seeds + cleans up its own.
    // The fixture's legacy version (data: null) renders the plain editor whose
    // "Submit for review" button has no eval-100% gate — so a real submit is
    // drivable here, exercising the Step-8 flip (submit → SME_REVIEW, not
    // SUBMITTED) that no other live test covers.
    const ip = await seedHandoutAtStatus({ status: 'IN_PROGRESS', smeEmail: 'sme@hmp.local' });
    try {
      await signIn(page, 'faculty@hmp.local');
      await page.goto(`/faculty/assignments/${ip.requestId}`);
      await page.getByRole('button', { name: /submit for review/i }).click();

      // The flip: a handout with an SmeAssignment routes to SME_REVIEW, NOT
      // straight to SUBMITTED (the legacy/opt-in path removed in 12-b).
      await expect
        .poll(
          async () => {
            const r = await prisma.handoutRequest.findUnique({
              where: { id: ip.requestId },
              select: { status: true },
            });
            return r?.status;
          },
          { timeout: 15_000 },
        )
        .toBe(HandoutStatus.SME_REVIEW);

      // SME_REVIEW_REQUESTED notifies the assigned SME + IC.
      const recip = await inPortalRecipients(ip.requestId, 'SME_REVIEW_REQUESTED');
      expect(recip.has('sme@hmp.local')).toBe(true);
      expect(recip.has('ic@hmp.local')).toBe(true);
    } finally {
      await prisma.handoutRequest.delete({ where: { id: ip.requestId } }).catch(() => undefined);
    }
  });

  test('the retired /sme/nominations route 404s for an authenticated SME', async ({ page }) => {
    // The advisory route tree was deleted in 12-b. An UNauthenticated hit is
    // intercepted by the auth middleware (307 → /login), so this must run as a
    // signed-in SME — who IS allowed past the middleware for /sme/* — to prove
    // the route itself is gone (Next returns 404, not a redirect).
    await signIn(page, 'sme@hmp.local');
    const resp = await page.goto('/sme/nominations');
    expect(resp?.status()).toBe(404);
  });
});

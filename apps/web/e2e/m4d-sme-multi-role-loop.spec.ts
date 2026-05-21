import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { prisma, SmeNominationStatus } from '@hmp/db';
import { seedHandoutAtStatus } from './fixtures/handout';

// m4d — the SME advisory feature's showcase test (Prompt 8).
// Exercises the full multi-role loop end-to-end with REAL email delivery:
//   PC nominates → SME accepts → SME comments → SME marks complete →
//   PC sees COMPLETED → faculty sees the advisory panel + comment.
//
// Context strategy: one browser context PER ROLE (PC / SME / faculty), each
// with its own cookie jar. Cleaner isolation than logout/login churn across a
// 9-step cross-role flow; ~200ms/context overhead is invisible vs the 90s
// test timeout.
//
// Email strategy: the three email-content assertions are gated behind a
// Mailhog reachability probe. The MULTI-ROLE FLOW ALWAYS RUNS (every DB + UI
// assertion executes regardless of Mailhog). Only the inbox checks are
// conditional — so the spec is full-coverage locally on a native-Postgres /
// no-Mailhog dev box, and full-coverage-PLUS-email in CI (where a Mailhog
// service is provisioned). The structure is "do step → email check IF Mailhog
// → do step → email check IF Mailhog", never "IF Mailhog do the whole spec".

const MAILHOG_BASE = process.env.MAILHOG_URL ?? 'http://localhost:8025';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

// ── Mailhog helpers ────────────────────────────────────────────────────────

interface MailhogMessage {
  Content: { Headers: { Subject?: string[]; To?: string[] }; Body?: string };
}

/**
 * Decodes RFC 2047 MIME "encoded-words" in a header value. nodemailer encodes
 * the entire Subject as `=?UTF-8?Q?...?=` (or `?B?` base64) whenever it
 * contains a non-ASCII char — our nomination subject has an em dash (—), so
 * the raw Mailhog header is encoded. Every real mail client decodes this
 * transparently; the test must too, to match the human-readable subject.
 *
 * Handles Q- and B-encoding, multi-byte UTF-8, and the RFC 2047 §6.2 rule that
 * linear whitespace BETWEEN adjacent encoded-words is removed.
 */
function decodeMimeWords(input: string): string {
  const joined = input.replace(/\?=\s+=\?/g, '?==?');
  return joined.replace(
    /=\?[^?]+\?([QqBb])\?([^?]*)\?=/g,
    (_full, enc: string, text: string) => {
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
    },
  );
}

/**
 * Logs a captured Mailhog message to the CI run so the rendered template
 * wording (and the ABSENCE of any literal {{token}}) is human-verifiable from
 * the Actions logs without downloading artifacts. QP soft line-breaks (`=\n`)
 * are stripped so a token split across a wrap isn't mistaken for a leak when
 * eyeballing the output.
 */
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

/**
 * Polls Mailhog for a message whose Subject matches `subjectRe` AND whose To
 * header includes `recipient`. Returns the matching message. Polls because the
 * notification is fired (awaited) inside the server action, but Mailhog's HTTP
 * API can lag the SMTP receipt by a few hundred ms.
 */
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

// ── Spec ─────────────────────────────────────────────────────────────────────

test.describe('SME advisory — full multi-role loop', () => {
  let requestId: string;
  let refNo: string;
  let mailhogUp = false;

  test.beforeEach(async () => {
    mailhogUp = await mailhogReachable();
    if (mailhogUp) await clearMailhog();

    // ASSIGNED: nomination-eligible (NOMINATION_ALLOWED_STATUSES) and the
    // fixture always creates a Handout + v1, so comments are possible.
    const seeded = await seedHandoutAtStatus({ status: 'ASSIGNED' });
    requestId = seeded.requestId;
    refNo = seeded.refNo;
  });

  test.afterEach(async () => {
    if (mailhogUp) await clearMailhog();
    // Per-spec scoped cleanup — cascades through SmeNomination, Comment,
    // AuditLog, Handout, HandoutVersion, Approval, FacultyAssignment.
    if (requestId) {
      await prisma.handoutRequest.delete({ where: { id: requestId } }).catch(() => undefined);
    }
  });

  test('PC nominates → SME accepts, comments, completes → PC + faculty see the result', async ({
    browser,
  }) => {
    const contexts: BrowserContext[] = [];
    const newCtxPage = async () => {
      const ctx = await browser.newContext();
      contexts.push(ctx);
      return ctx.newPage();
    };

    try {
      // ── Step 1 — PC nominates the SME ──────────────────────────────────────
      const pcPage = await newCtxPage();
      await signIn(pcPage, 'pc@hmp.local');
      await pcPage.goto(`/pc/requests/${requestId}`);

      await expect(pcPage.getByRole('heading', { name: /sme nominations/i })).toBeVisible();
      await pcPage.getByLabel('SME').selectOption({ label: 'Dr. Sneha Mehta — sme@hmp.local' });
      await pcPage.getByLabel(/^Topic/).fill('Industry case study selection');
      await pcPage.getByLabel(/^Notes/).fill('Looking for guidance on real-world examples');
      await pcPage.getByRole('button', { name: /nominate sme/i }).click();

      // Persistent signal: new PENDING row in the panel.
      await expect(
        pcPage
          .getByRole('listitem')
          .filter({ hasText: 'Dr. Sneha Mehta' })
          .filter({ hasText: 'PENDING' }),
      ).toBeVisible({ timeout: 30_000 });

      // Resolve the nominationId for SME navigation + DB checks.
      const nomination = await prisma.smeNomination.findFirstOrThrow({
        where: { requestId },
        select: { id: true },
      });
      const nominationId = nomination.id;

      // Email check 1 — nomination → SME (gated on Mailhog).
      if (mailhogUp) {
        const email = await waitForEmail(
          new RegExp(`^SME nomination: ${refNo} — `),
          'sme@hmp.local',
        );
        logCapturedEmail('sme_nominated', email);
        // Token-contract end-to-end guard: a rendered template must not leak
        // any literal {{token}} into the recipient's inbox. Check subject AND
        // body (the nomination template renders the most tokens: courseCode,
        // courseTitle, actor, topic). QP soft-breaks stripped before the check.
        expect(decodeMimeWords(email.Content.Headers.Subject?.[0] ?? '')).not.toContain('{{');
        expect((email.Content.Body ?? '').replace(/=\r?\n/g, '')).not.toContain('{{');
        await clearMailhog();
      }

      // ── Step 3 — SME accepts ───────────────────────────────────────────────
      const smePage = await newCtxPage();
      await signIn(smePage, 'sme@hmp.local');

      // Dashboard surfaces the pending nomination (scoped by unique refNo).
      await expect(
        smePage.getByRole('listitem').filter({ hasText: refNo }),
      ).toBeVisible();

      await smePage.goto(`/sme/nominations/${nominationId}`);
      await smePage.getByRole('button', { name: /accept nomination/i }).click();
      await expect(smePage.getByText('ACCEPTED', { exact: true }).first()).toBeVisible({
        timeout: 30_000,
      });

      // Email check 2 — accepted → PC.
      if (mailhogUp) {
        const email = await waitForEmail(new RegExp(`^SME accepted: ${refNo}`), 'pc@hmp.local');
        logCapturedEmail('sme_accepted', email);
        expect(decodeMimeWords(email.Content.Headers.Subject?.[0] ?? '')).not.toContain('{{');
        await clearMailhog();
      }

      // ── Step 5 — SME comments ──────────────────────────────────────────────
      await smePage
        .getByLabel(/add a comment/i)
        .fill('Recommend three case studies: Stripe API design, Slack scaling, Netflix chaos engineering');
      await smePage.getByRole('button', { name: /post comment/i }).click();
      await expect(
        smePage.getByText(/Recommend three case studies/),
      ).toBeVisible({ timeout: 30_000 });

      // ── Step 6 — SME marks complete ────────────────────────────────────────
      await smePage.getByRole('button', { name: /mark nomination complete/i }).click();
      await expect(smePage.getByText('COMPLETED', { exact: true }).first()).toBeVisible({
        timeout: 30_000,
      });

      // DB confirms COMPLETED + the audit row.
      {
        const row = await prisma.smeNomination.findUnique({
          where: { id: nominationId },
          select: { status: true, completedAt: true },
        });
        expect(row?.status).toBe(SmeNominationStatus.COMPLETED);
        expect(row?.completedAt).not.toBeNull();
        const audit = await prisma.auditLog.findFirst({
          where: { requestId, action: 'sme.completed', entityId: nominationId },
          select: { id: true },
        });
        expect(audit).not.toBeNull();
      }

      // Email check 3 — completed → PC + assigned faculty (multi-recipient).
      if (mailhogUp) {
        const pcEmail = await waitForEmail(
          new RegExp(`^SME review complete: ${refNo}`),
          'pc@hmp.local',
        );
        logCapturedEmail('sme_completed', pcEmail);
        expect(decodeMimeWords(pcEmail.Content.Headers.Subject?.[0] ?? '')).not.toContain('{{');
        // Faculty is the second recipient of the completion fan-out.
        const facultyEmail = await waitForEmail(
          new RegExp(`^SME review complete: ${refNo}`),
          'faculty@hmp.local',
        );
        logCapturedEmail('sme_completed → faculty', facultyEmail);
      }

      // ── Step 8 — PC sees COMPLETED ─────────────────────────────────────────
      await pcPage.goto(`/pc/requests/${requestId}`);
      // Scope by the topic text — it's unique to the SmeNominationsPanel row.
      // The PC's notification bell now holds an "sme.completed" entry that also
      // contains "Dr. Sneha Mehta" + "COMPLETED" (PC is a completion recipient),
      // which would otherwise trip strict-mode.
      await expect(
        pcPage
          .getByRole('listitem')
          .filter({ hasText: 'Industry case study selection' })
          .filter({ hasText: 'COMPLETED' }),
      ).toBeVisible({ timeout: 30_000 });

      // ── Step 9 — Faculty sees the advisory panel + the comment ─────────────
      const facultyPage = await newCtxPage();
      await signIn(facultyPage, 'faculty@hmp.local');
      await facultyPage.goto(`/faculty/assignments/${requestId}`);

      await expect(
        facultyPage.getByRole('heading', { name: /smes advising on this handout/i }),
      ).toBeVisible();
      // "View comments" anchor is unique to SmeAdvisoryPanel — disambiguates
      // from notification-bell entries sharing the same text.
      const advisoryRow = facultyPage
        .getByRole('listitem')
        .filter({ has: facultyPage.getByRole('link', { name: 'View comments' }) })
        .filter({ hasText: 'Dr. Sneha Mehta' })
        .filter({ hasText: 'COMPLETED' });
      await expect(advisoryRow).toBeVisible();
      // The SME's comment is visible in the faculty's discussion thread.
      await expect(facultyPage.getByText(/Recommend three case studies/)).toBeVisible();
    } finally {
      for (const ctx of contexts) await ctx.close();
    }
  });
});

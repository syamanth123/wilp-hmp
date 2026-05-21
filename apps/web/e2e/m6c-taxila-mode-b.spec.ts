import { test, expect, type Page } from '@playwright/test';
import AdmZip from 'adm-zip';
import { prisma, LmsPublishMode } from '@hmp/db';
import { seedHandoutAtStatus, cleanupTestHandouts } from './fixtures/handout';

// ─── REQUIRES MINIO (+ Mailhog for the email assertion) ──────────────────────
// Deep Mode B test: publishes (export), downloads the actual ZIP and verifies
// its four files, checks the LmsPublishLog rows, asserts the export-ready
// notification email (Mailhog), then confirms manual publication and checks the
// MANUALLY_CONFIRMED log + PUBLISHED state. Needs MinIO; the email step also
// needs Mailhog. SKIPS locally without Docker; RUNS in CI which provides both.
// See .github/workflows/ci.yml.
// ─────────────────────────────────────────────────────────────────────────────

const S3_ENDPOINT = process.env.S3_ENDPOINT ?? 'http://localhost:9000';
const MAILHOG_BASE = process.env.MAILHOG_URL ?? 'http://localhost:8025';

async function reachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

async function clearMailhog() {
  try {
    await fetch(`${MAILHOG_BASE}/api/v1/messages`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    /* best-effort */
  }
}

test.describe('Taxila Mode B — export package + manual confirm', () => {
  let requestId: string;
  let refNo: string;
  let skip = false;
  let mailhogUp = false;

  test.beforeEach(async () => {
    skip = !(await reachable(`${S3_ENDPOINT}/minio/health/live`));
    test.skip(skip, 'MinIO not reachable — Mode B requires object storage (CI only)');
    mailhogUp = await reachable(`${MAILHOG_BASE}/api/v2/messages?limit=1`);
    if (mailhogUp) await clearMailhog();
    const seeded = await seedHandoutAtStatus({ status: 'APPROVED' });
    requestId = seeded.requestId;
    refNo = seeded.refNo;
  });

  test.afterEach(async () => {
    if (mailhogUp) await clearMailhog();
    if (!skip) await cleanupTestHandouts();
  });

  test('export ZIP has all four files; logs + notification + manual confirm all correct', async ({
    page,
  }) => {
    await signIn(page, 'ic@hmp.local');
    await page.goto(`/ic/requests/${requestId}`);
    await expect(page.getByRole('heading', { name: 'Publish to LMS' })).toBeVisible();

    // Publish → Mode B export.
    await page.getByRole('button', { name: /publish to lms/i }).click();
    const downloadLink = page.getByRole('link', { name: /download the export package/i });
    await expect(downloadLink).toBeVisible({ timeout: 30_000 });

    // Download the actual ZIP via the presigned URL and verify its contents.
    const href = (await downloadLink.getAttribute('href'))!;
    const res = await page.request.get(href);
    expect(res.status()).toBe(200);
    const zip = new AdmZip(Buffer.from(await res.body()));
    const names = zip
      .getEntries()
      .map((e) => e.entryName)
      .sort();
    expect(names).toEqual(['README.txt', 'handout.html', 'handout.json', 'metadata.json']);
    for (const e of zip.getEntries()) {
      expect(e.getData().length, `${e.entryName} must be non-empty`).toBeGreaterThan(0);
    }
    // metadata.json carries the right refNo.
    const meta = JSON.parse(zip.getEntry('metadata.json')!.getData().toString('utf8'));
    expect(meta.refNo).toBe(refNo);

    // DB: an EXPORTED log exists; no MANUALLY_CONFIRMED yet.
    const handout = await prisma.handout.findFirstOrThrow({
      where: { request: { id: requestId } },
      select: { id: true },
    });
    {
      const exported = await prisma.lmsPublishLog.findFirst({
        where: { handoutId: handout.id, mode: LmsPublishMode.EXPORT, status: 'EXPORTED' },
        select: { s3Key: true },
      });
      expect(exported?.s3Key).toContain(`${refNo}.zip`);
      const confirmedYet = await prisma.lmsPublishLog.findFirst({
        where: { handoutId: handout.id, status: 'MANUALLY_CONFIRMED' },
      });
      expect(confirmedYet).toBeNull();
    }

    // Notification: export-ready email reaches an IC recipient (Mailhog).
    if (mailhogUp) {
      const deadline = Date.now() + 15_000;
      let match: {
        Content: { Headers: { Subject?: string[]; To?: string[] }; Body?: string };
      } | null = null;
      while (Date.now() < deadline && !match) {
        const msgs = (await (await fetch(`${MAILHOG_BASE}/api/v2/messages?limit=50`)).json()) as {
          items: { Content: { Headers: { Subject?: string[]; To?: string[] }; Body?: string } }[];
        };
        match =
          msgs.items.find((m) =>
            (m.Content.Headers.Subject?.[0] ?? '').includes(
              `Export ready for manual upload: ${refNo}`,
            ),
          ) ?? null;
        if (!match) await new Promise((r) => setTimeout(r, 500));
      }
      expect(match, 'export-ready email should arrive in Mailhog').not.toBeNull();
      // CONTRACT ARTIFACT — log the captured email so the rendered wording (and
      // absence of any literal {{token}}) is human-verifiable from the CI logs.
      const subject = match!.Content.Headers.Subject?.[0] ?? '';
      const body = (match!.Content.Body ?? '').replace(/=\r?\n/g, '').slice(0, 500);
      console.log(
        `\n=== CAPTURED EMAIL [publish_export_ready] ===\nTo: ${(match!.Content.Headers.To ?? []).join(', ')}\nSubject: ${subject}\nBody: ${body}\n=== END EMAIL ===\n`,
      );
      expect(subject).not.toContain('{{');
      expect((match!.Content.Body ?? '').replace(/=\r?\n/g, '')).not.toContain('{{');
    }

    // Confirm manual publication → PUBLISHED + MANUALLY_CONFIRMED log.
    await page.getByRole('button', { name: /mark as manually published/i }).click();
    await expect(page.getByRole('heading', { name: 'Archive', exact: true })).toBeVisible({
      timeout: 30_000,
    });

    {
      const confirmed = await prisma.lmsPublishLog.findFirst({
        where: { handoutId: handout.id, status: 'MANUALLY_CONFIRMED' },
        select: { mode: true, externalRef: true },
      });
      expect(confirmed?.mode).toBe(LmsPublishMode.MANUALLY_CONFIRMED);
      // externalRef chains back to the source export's durable s3Key.
      expect(confirmed?.externalRef).toContain(`${refNo}.zip`);
      const req = await prisma.handoutRequest.findUnique({
        where: { id: requestId },
        select: { status: true },
      });
      expect(req?.status).toBe('PUBLISHED');
    }
  });
});

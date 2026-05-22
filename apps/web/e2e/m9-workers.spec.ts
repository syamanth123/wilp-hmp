import { test, expect, type Page } from '@playwright/test';
import { prisma } from '@hmp/db';
import { seedHandoutAtStatus, cleanupTestHandouts } from './fixtures/handout';

// ─── REQUIRES WORKERS_ENABLED + REAL REDIS + A RUNNING WORKER ────────────────
// Proves the QUEUED notification path delivers end-to-end. The main e2e run has
// WORKERS_ENABLED unset, so this spec SKIPS there (and locally without Redis).
// CI runs it in a dedicated step that sets WORKERS_ENABLED=true, starts the
// worker process (`pnpm workers`), then runs only this spec. See ci.yml.
//
// The falsifiable assertion is DELIVERY, not timing. With WORKERS_ENABLED the
// action ENQUEUES the notification (it does NOT run inline), so the Notification
// row is created ONLY if a worker dequeues and processes the job. No worker →
// row never appears → the poll times out → the test fails. That's what
// distinguishes "queued and delivered" from "queued and lost". (Comment
// notifications are in-portal only — no email — so the delivery proof is the
// Notification row, not Mailhog. Response time on localhost is a weak
// discriminator, so it's logged, not asserted.)
// ─────────────────────────────────────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL;
const WORKERS_ON = process.env.WORKERS_ENABLED === 'true';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

test.describe('workers — queued notification delivers end-to-end', () => {
  let requestId: string;
  let infraUp = false;

  test.beforeEach(async () => {
    infraUp = WORKERS_ON && Boolean(REDIS_URL);
    test.skip(!infraUp, 'Needs WORKERS_ENABLED=true + Redis + a running worker (CI step only)');
    // IN_PROGRESS so a handout + version exist and a comment is possible.
    const seeded = await seedHandoutAtStatus({ status: 'IN_PROGRESS' });
    requestId = seeded.requestId;
  });

  test.afterEach(async () => {
    if (infraUp) await cleanupTestHandouts();
  });

  test('a comment enqueues a notification that the worker processes into a Notification row', async ({
    page,
  }) => {
    await signIn(page, 'pc@hmp.local');
    await page.goto(`/pc/requests/${requestId}`);

    // Baseline: no comment notification for this request yet.
    const countCommentNotifs = async () =>
      prisma.notification.count({
        where: {
          AND: [
            { meta: { path: ['kind'], equals: 'comment.added' } },
            { meta: { path: ['requestId'], equals: requestId } },
          ],
        },
      });
    expect(await countCommentNotifs()).toBe(0);

    // Post a comment; time the round-trip (soft signal, logged not asserted).
    await page.getByLabel('Add a comment').fill('Worker-path delivery check.');
    const started = Date.now();
    await page.getByRole('button', { name: /post comment/i }).click();
    await expect(page.getByLabel('Add a comment')).toHaveValue('', { timeout: 15_000 });

    console.log(`[m9] comment action round-trip: ${Date.now() - started}ms (queued; not asserted)`);

    // THE proof: a comment.added Notification row appears — which only happens
    // if the worker dequeued and processed the job (the action enqueued it,
    // it did NOT run inline because WORKERS_ENABLED=true).
    const deadline = Date.now() + 15_000;
    let count = 0;
    while (Date.now() < deadline && count === 0) {
      count = await countCommentNotifs();
      if (count === 0) await new Promise((r) => setTimeout(r, 500));
    }
    expect(count, 'worker should have created the comment notification row(s)').toBeGreaterThan(0);
  });

  test('admin queues page renders with live worker heartbeat', async ({ page }) => {
    await signIn(page, 'admin@hmp.local');
    const res = await page.goto('/admin/queues');
    expect(res?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: /notifications queue/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /ai queue/i })).toBeVisible();
    // A worker is running in this step → heartbeat is fresh, not the warning.
    await expect(page.getByText(/Worker heartbeat/i).first()).toBeVisible();
    await expect(page.getByText(/Workers may not be running/i)).toHaveCount(0);
  });
});

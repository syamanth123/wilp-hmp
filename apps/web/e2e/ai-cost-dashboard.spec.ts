import { test, expect, type Page } from '@playwright/test';
import { prisma } from '@hmp/db';

// Prompt 17: AI cost dashboard. Seeds AiUsageLog rows directly via prisma (no AI
// provider needed) and checks the admin /admin/ai-metrics cost cards render
// them. No MinIO/Redis — runs anywhere Postgres is up. Rows are tracked by id
// and removed in afterEach.

const seededIds: string[] = [];

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

test.afterEach(async () => {
  if (seededIds.length) {
    await prisma.aiUsageLog.deleteMany({ where: { id: { in: seededIds } } });
    seededIds.length = 0;
  }
});

test('admin sees AI cost cards reflecting seeded usage', async ({ page }) => {
  // Seed a couple of cost-ledger rows for the current month (userId/handoutId
  // null — both are nullable; this keeps the seed free of user/handout setup).
  const rows = await Promise.all([
    prisma.aiUsageLog.create({
      data: {
        operation: 'DRAFT_GENERATION',
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
        tokensIn: 1200,
        tokensOut: 3400,
        costUsd: 1.25,
        durationMs: 800,
        succeeded: true,
      },
      select: { id: true },
    }),
    prisma.aiUsageLog.create({
      data: {
        operation: 'QUALITY_REPORT',
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
        tokensIn: 900,
        tokensOut: 600,
        costUsd: 0.4,
        durationMs: 500,
        succeeded: true,
      },
      select: { id: true },
    }),
  ]);
  seededIds.push(...rows.map((r) => r.id));

  await signIn(page, 'admin@hmp.local');
  await page.goto('/admin/ai-metrics');

  // The month cost card renders.
  await expect(page.getByText(/AI cost —/)).toBeVisible();

  // The by-operation breakdown lists the seeded operations.
  await expect(page.getByText('Cost by operation', { exact: false })).toBeVisible();
  await expect(page.getByText('DRAFT_GENERATION')).toBeVisible();
  await expect(page.getByText('QUALITY_REPORT')).toBeVisible();
});

test('AI metrics page renders with no cost data (empty-safe)', async ({ page }) => {
  // We don't wipe the table (other rows may exist), but the page must render its
  // cost cards regardless — this is the "fresh deploy" empty-safety path.
  await signIn(page, 'admin@hmp.local');
  await page.goto('/admin/ai-metrics');
  await expect(page.getByText(/AI cost —/)).toBeVisible();
  await expect(page.getByText('Cost by operation', { exact: false })).toBeVisible();
  await expect(page.getByText('Monthly trend (6 months)')).toBeVisible();
  await expect(page.getByText('Top users', { exact: false })).toBeVisible();
  await expect(page.getByText('Top handouts', { exact: false })).toBeVisible();
});

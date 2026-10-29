import { test, expect, type Page } from '@playwright/test';
import { seedHandoutAtStatus, cleanupTestHandouts } from './fixtures/handout';

// Every number on a dashboard card must equal the list it links to, for the
// same signed-in user. One test per role walks every linked card: read the
// number, follow the link, compare with the list's total and its rows.
//
// Seeds handouts across the workflow (including one with the subject expert)
// so most cards are non-zero. The suite runs on a single worker, so nothing
// changes between reading a card and opening its list.

const PAGE_SIZE = 25;

const ROLES = [
  { email: 'ic@hmp.local', home: '/ic' },
  { email: 'hog@hmp.local', home: '/hog' },
  { email: 'pc@hmp.local', home: '/pc' },
  { email: 'faculty@hmp.local', home: '/faculty' },
  { email: 'sme@hmp.local', home: '/sme' },
  { email: 'admin@hmp.local', home: '/admin' },
];

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

async function readCards(page: Page): Promise<{ value: number; href: string }[]> {
  const cards = page.getByTestId('stat-card');
  const out: { value: number; href: string }[] = [];
  for (let i = 0; i < (await cards.count()); i++) {
    const card = cards.nth(i);
    const href =
      (await card.getAttribute('href')) ??
      ((await card.getByTestId('stat-link').count())
        ? await card.getByTestId('stat-link').getAttribute('href')
        : null);
    if (!href) continue;
    const value = Number((await card.getByTestId('stat-value').innerText()).trim());
    out.push({ value, href });
  }
  return out;
}

test.describe('Dashboard cards match the lists they link to', () => {
  test.beforeAll(async () => {
    for (const status of [
      'ASSIGNED',
      'IN_PROGRESS',
      'SME_REVIEW',
      'APPROVED',
      'PUBLISHED',
    ] as const) {
      await seedHandoutAtStatus({ status, smeEmail: 'sme@hmp.local' });
    }
  });

  test.afterAll(async () => {
    await cleanupTestHandouts();
  });

  for (const role of ROLES) {
    test(`${role.home}: every card number equals its list`, async ({ page }) => {
      await signIn(page, role.email);
      await page.goto(role.home);
      const cards = await readCards(page);
      expect(cards.length, `${role.home} has linked cards`).toBeGreaterThan(0);

      for (const card of cards) {
        await page.goto(card.href);
        const total = Number((await page.getByTestId('list-total').innerText()).trim());
        expect(total, `${role.home} card → ${card.href}`).toBe(card.value);
        // Request lists show 25 per page; the users list isn't paged.
        const paged = !card.href.startsWith('/admin/users');
        const rows = await page.locator('table tbody tr').count();
        expect(rows, `rows on ${card.href}`).toBe(
          paged ? Math.min(card.value, PAGE_SIZE) : card.value,
        );
      }
    });
  }

  test('a handout with the subject expert shows in every list that covers it', async ({ page }) => {
    for (const [email, list] of [
      ['hog@hmp.local', '/hog/requests?status=SME_REVIEW'],
      ['pc@hmp.local', '/pc/requests?status=SME_REVIEW'],
      ['faculty@hmp.local', '/faculty/assignments?status=SME_REVIEW'],
      ['ic@hmp.local', '/ic/requests?status=SME_REVIEW'],
    ] as const) {
      await page.context().clearCookies();
      await signIn(page, email);
      await page.goto(list);
      await expect(page.locator('[data-status="SME_REVIEW"]').first()).toBeVisible();
      await expect(page.locator('[data-status="SME_REVIEW"]').first()).toHaveText(
        'With subject expert for review',
      );
    }
  });

  test('an unknown filter in the address is ignored, with a note', async ({ page }) => {
    await signIn(page, 'pc@hmp.local');
    await page.goto('/pc/requests?status=NOT_A_STATUS');
    await expect(page.getByTestId('filter-ignored')).toBeVisible();
    await page.goto('/pc/requests');
    const all = await page.getByTestId('list-total').innerText();
    await page.goto('/pc/requests?status=REQUESTED'); // outside the PC list
    await expect(page.getByTestId('filter-ignored')).toBeVisible();
    await expect(page.getByTestId('list-total')).toHaveText(all);
  });
});

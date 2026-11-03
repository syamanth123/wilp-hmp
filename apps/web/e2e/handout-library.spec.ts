import { test, expect, type Browser, type Page } from '@playwright/test';
import { prisma } from '@hmp/db';
import { cleanupTestHandouts, seedHandoutAtStatus, type SeededHandout } from './fixtures/handout';

// Handout Library (v1.2.0, docs/plans/handout-library.md): each role lands on its own default
// view; tab counts equal the lists they open; nobody sees another person's draft — not in the
// list, not by URL, not as a download; compare works; the Excel export is for oversight roles.

const DATA = {
  schemaVersion: 1,
  metadata: {
    institutionHeader: 'Birla Institute of Technology & Science, Pilani',
    divisionHeader: 'Work Integrated Learning Programmes Division',
    semester: 'First Semester 2025-2026',
    documentTitle: 'Course Handout',
    formNumber: '',
  },
  partA: {
    courseTitle: 'Library Test Course',
    courseNumbers: ['SE ZG501'],
    creditModel: { description: '3-1-1' },
    instructors: ['Dr. Library'],
    date: '01-08-2025',
    courseDescription: '<p>The first description.</p>',
    courseObjectives: [{ code: 'CO1', description: 'Understand the basics' }],
    textBooks: [{ code: 'T1', citation: 'A book' }],
    referenceBooks: [],
    learningOutcomes: [{ code: 'LO1', description: 'Apply the basics' }],
  },
  partB: {
    sessions: [{ sessionNumber: '1', topicTitle: 'Introduction', subTopics: '', references: [] }],
  },
  evaluation: {
    legend: '',
    components: [
      {
        ecNumber: 'EC-1',
        subComponents: [{ name: 'Quiz', type: 'Online', weight: 100, duration: '1h' }],
      },
    ],
    notes: '',
    midSemSyllabus: '',
    compreSyllabus: '',
  },
  importantLinks: {
    elearnPortalUrl: 'https://elearn.bits-pilani.ac.in',
    elearnPortalNote: '',
    contactSessionsNote: '',
  },
  evaluationGuidelines: '<p>Guidelines.</p>',
};

const V2 = {
  ...DATA,
  partA: {
    ...DATA.partA,
    courseDescription: '<p>The revised description.</p>',
    courseObjectives: [
      { code: 'CO1', description: 'Understand the basics' },
      { code: 'CO2', description: 'Design a small system' },
    ],
  },
};

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

async function as(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signIn(page, email);
  return page;
}

/** Gives a seeded handout two structured versions (v1 → v2), v2 current. */
async function makeStructured(h: SeededHandout) {
  const v1 = await prisma.handoutVersion.findFirstOrThrow({
    where: { handoutId: h.handoutId, versionNo: 1 },
  });
  await prisma.handoutVersion.update({ where: { id: v1.id }, data: { data: DATA } });
  const v2 = await prisma.handoutVersion.create({
    data: {
      handoutId: h.handoutId,
      versionNo: 2,
      contentHtml: '',
      data: V2,
      authorId: v1.authorId,
      notes: 'Added CO2',
    },
  });
  await prisma.handout.update({ where: { id: h.handoutId }, data: { currentVersionId: v2.id } });
}

const courseTotal = async (page: Page) =>
  Number(/^(\d+)/.exec((await page.getByTestId('list-total').innerText()).trim())![1]);

let mine: SeededHandout; // faculty@hmp.local, in progress, submitted to the SME
let others: SeededHandout; // faculty2@hmp.local, in progress — nobody else's business
let published: SeededHandout; // published, two structured versions

test.describe('Handout Library', () => {
  test.beforeAll(async () => {
    mine = await seedHandoutAtStatus({ status: 'SME_REVIEW', smeEmail: 'sme@hmp.local' });
    others = await seedHandoutAtStatus({
      status: 'IN_PROGRESS',
      facultyEmail: 'faculty2@hmp.local',
    });
    published = await seedHandoutAtStatus({ status: 'PUBLISHED' });
    await makeStructured(mine);
    await makeStructured(published);
  });

  test.afterAll(async () => {
    await cleanupTestHandouts();
    await prisma.savedView.deleteMany({ where: { name: { startsWith: 'E2E ' } } });
  });

  const DEFAULTS = [
    { email: 'ic@hmp.local', view: 'this-term', tab: 'in-progress' },
    { email: 'admin@hmp.local', view: 'this-term', tab: 'in-progress' },
    { email: 'hog@hmp.local', view: 'needs-action', tab: 'in-progress' },
    { email: 'pc@hmp.local', view: 'needs-action', tab: 'in-progress' },
    { email: 'faculty@hmp.local', view: 'needs-action', tab: 'in-progress' },
    { email: 'sme@hmp.local', view: 'needs-action', tab: 'in-progress' },
  ];

  for (const r of DEFAULTS) {
    // Tab counts = lists: dashboard-counts.spec.ts ("Handout Library tabs…").
    test(`${r.email}: opens on its default view; every quick-view count equals its list`, async ({
      browser,
    }) => {
      const page = await as(browser, r.email);
      await page.goto('/handouts');
      await expect(page.getByTestId(`quick-view-${r.view}`)).toHaveAttribute(
        'aria-current',
        'true',
      );
      await expect(page.getByTestId(`library-tab-${r.tab}`)).toHaveAttribute(
        'aria-current',
        'page',
      );

      // Every counted quick view opens a list with that many courses.
      await page.goto('/handouts');
      const chips = page.locator('a[data-testid^="quick-view-"]');
      const views: { href: string; count: number }[] = [];
      for (let i = 0; i < (await chips.count()); i++) {
        const chip = chips.nth(i);
        const c = chip.getByTestId('quick-view-count');
        const href = (await chip.getAttribute('href'))!;
        if (href.startsWith('/handouts') && (await c.count()))
          views.push({ href, count: Number((await c.innerText()).replace(/\D/g, '')) });
      }
      expect(views.length).toBeGreaterThan(1);
      for (const v of views) {
        await page.goto(v.href);
        expect(await courseTotal(page), v.href).toBe(v.count);
      }
    });
  }

  test('faculty and SMEs never see someone else’s draft — list, URL or download', async ({
    browser,
  }) => {
    for (const email of ['faculty@hmp.local', 'sme@hmp.local']) {
      const page = await as(browser, email);
      await page.goto(`/handouts?tab=in-progress&term=all&q=${others.refNo}`);
      expect(await courseTotal(page)).toBe(0);
      await page.goto(`/handouts/${others.requestId}`);
      await expect(page.getByTestId('access-denied')).toBeVisible();
      const dl = await page.request.get(`/api/handouts/${others.requestId}/export/docx`);
      expect(dl.status(), email).toBe(403);
      const sug = await page.request.get(`/api/handouts/suggest?q=${others.refNo}`);
      expect((await sug.json()).courses).toEqual([]);
    }
    // …while their own (faculty) / assigned (SME) one opens.
    const fac = await as(browser, 'faculty@hmp.local');
    await fac.goto(`/handouts/${mine.requestId}`);
    await expect(fac.getByTestId('handout-viewer-page')).toBeVisible();
    await expect(fac.getByTestId('version-history')).toBeVisible();
  });

  test('an in-progress download carries the draft mark note; the assigned SME may download', async ({
    browser,
  }) => {
    const sme = await as(browser, 'sme@hmp.local');
    await sme.goto(`/handouts/${mine.requestId}`);
    await expect(sme.getByTestId('draft-download-note')).toBeVisible();
    const dl = await sme.request.get(`/api/handouts/${mine.requestId}/export/docx`);
    expect(dl.status()).toBe(200);
  });

  test('compare two versions side by side', async ({ browser }) => {
    const page = await as(browser, 'ic@hmp.local');
    await page.goto(`/handouts/${published.requestId}?cmp=v1`);
    await expect(page.getByTestId('compare-view')).toBeVisible();
    await expect(page.getByTestId('compare-summary')).toContainText('items differ');
    await expect(page.locator('[data-kind="added"]').first()).toBeVisible();
    await expect(page.locator('[data-kind="changed"]').first()).toBeVisible();
  });

  test('another faculty member sees the published handout but not its draft history', async ({
    browser,
  }) => {
    const page = await as(browser, 'faculty2@hmp.local');
    await page.goto(`/handouts/${published.requestId}`);
    await expect(page.getByTestId('handout-viewer-page')).toBeVisible();
    await expect(page.getByTestId('version-history')).toHaveCount(0);
    await page.goto(`/handouts/${published.requestId}?v=1`);
    await expect(page.getByTestId('old-version-note')).toHaveCount(0);
  });

  test('filters show as chips; Clear all removes them; saved views come back', async ({
    browser,
  }) => {
    const page = await as(browser, 'ic@hmp.local');
    await page.goto('/handouts?tab=published&term=all&status=published');
    await expect(page.getByTestId('filter-chip')).toHaveCount(2);
    await page.getByTestId('save-view').locator('summary').click();
    await page.getByLabel('Name this view').fill('E2E published');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByTestId('save-view-message')).toContainText('Saved');
    await page.getByTestId('clear-all').click();
    await expect(page.getByTestId('filter-chip')).toHaveCount(0);
    await page.getByTestId('saved-view').getByRole('link', { name: 'E2E published' }).click();
    await expect(page.getByTestId('filter-chip')).toHaveCount(2);
  });

  test('Excel export: oversight roles only', async ({ browser }) => {
    const ic = await as(browser, 'ic@hmp.local');
    const ok = await ic.request.get('/api/handouts/library/export?tab=published&term=all');
    expect(ok.status()).toBe(200);
    expect(ok.headers()['content-type']).toContain('spreadsheetml');
    const fac = await as(browser, 'faculty@hmp.local');
    const no = await fac.request.get('/api/handouts/library/export?tab=published&term=all');
    expect(no.status()).toBe(403);
  });
});

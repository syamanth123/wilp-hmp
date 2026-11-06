import { test, expect, type Browser, type Page } from '@playwright/test';
import {
  prisma,
  HandoutStatus,
  ApprovalStage,
  ApprovalDecision,
  FacultyType,
  type Prisma,
} from '@hmp/db';
import { startFakeMoodle, type FakeMoodle } from '@hmp/integrations/src/testing/fake-moodle';
import { cleanupTestHandouts } from './fixtures/handout';

// "Mode C": publish into Taxila — against a FAKE Taxila started here, never the real one. The file is
// always "Course Handout.pdf" in the course's "Course Handout" File item (v1.3.1).
// Runs only in the ci-local / CI step "e2e (Taxila on)", which starts the app with
// TAXILA_URL=http://127.0.0.1:4599/webservice/ and TAXILA_TOKEN set; the main e2e run (no Taxila
// settings) skips it and keeps testing the ZIP flow (m6a, m6c). Needs LibreOffice for the PDF.

const PORT = 4599;
const TAXILA_URL = process.env.TAXILA_URL ?? '';
const TOKEN = process.env.TAXILA_TOKEN ?? '';
const ON = TAXILA_URL.includes(`127.0.0.1:${PORT}`) && !!TOKEN;
const SEM = 'S1-25'; // the dev seed's semester is "Sem-I 2025-26"

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
    courseTitle: 'Taxila Publish Test',
    courseNumbers: ['SE ZG501'],
    creditModel: { description: '3-1-1' },
    instructors: ['Dr. Taxila'],
    date: '01-08-2025',
    courseDescription: '<p>Published by the e2e test into a fake Taxila.</p>',
    courseObjectives: [{ code: 'CO1', description: 'obj' }],
    textBooks: [{ code: 'T1', citation: 'book' }],
    referenceBooks: [],
    learningOutcomes: [{ code: 'LO1', description: 'out' }],
  },
  partB: { sessions: [{ sessionNumber: '1', topicTitle: 'Intro', subTopics: '', references: [] }] },
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

const seeded: string[] = [];

/** An APPROVED handout with structured content on the dev seed's offering for `courseCode`. */
async function seedApproved(courseCode: string): Promise<string> {
  const [faculty, ic, hog, offering] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { email: 'faculty@hmp.local' }, select: { id: true } }),
    prisma.user.findUniqueOrThrow({ where: { email: 'ic@hmp.local' }, select: { id: true } }),
    prisma.user.findUniqueOrThrow({ where: { email: 'hog@hmp.local' }, select: { id: true } }),
    prisma.courseOffering.findFirstOrThrow({
      where: { course: { code: courseCode } },
      select: { id: true },
    }),
  ]);
  const req = await prisma.handoutRequest.create({
    data: {
      refNo: `HMP-8888-${process.hrtime.bigint().toString(36)}`,
      courseOfferingId: offering.id,
      initiatedById: ic.id,
      status: HandoutStatus.APPROVED,
      handout: { create: { status: HandoutStatus.APPROVED } },
      assignments: {
        create: { facultyId: faculty.id, facultyType: FacultyType.ON_CAMPUS, active: true },
      },
      approvals: {
        create: {
          stage: ApprovalStage.HOG_FINAL,
          decision: ApprovalDecision.APPROVED,
          reviewerId: hog.id,
          decidedAt: new Date(),
        },
      },
    },
    select: { id: true, handout: { select: { id: true } } },
  });
  const v = await prisma.handoutVersion.create({
    data: {
      handoutId: req.handout!.id,
      versionNo: 1,
      contentJson: {} as Prisma.InputJsonValue,
      contentHtml: '<p>legacy</p>',
      data: {
        ...DATA,
        partA: { ...DATA.partA, courseNumbers: [courseCode] },
      } as unknown as Prisma.InputJsonValue,
      authorId: faculty.id,
    },
  });
  await prisma.handout.update({ where: { id: req.handout!.id }, data: { currentVersionId: v.id } });
  seeded.push(req.id);
  return req.id;
}

async function asIc(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/login');
  await page.getByLabel('Email').fill('ic@hmp.local');
  await page.getByLabel('Password').fill('password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
  return page;
}

test.describe('Publish into Taxila (fake Taxila)', () => {
  test.skip(!ON, 'Runs only in the "e2e (Taxila on)" step');

  let fake: FakeMoodle;
  const started = new Date();

  test.beforeAll(async () => {
    fake = await startFakeMoodle({
      token: TOKEN,
      port: PORT,
      courses: [
        {
          id: 501,
          fullname: `Software Engineering (${SEM}_SEZG501)`,
          item: {
            name: 'Course Handout',
            contextid: 9501,
            files: [{ filename: 'Course Handout.pdf', size: 900 }],
          },
          // An old-style folder of the same name is never used.
          extraModules: [{ name: 'Course Handout', modname: 'folder', contextid: 8501 }],
        },
        // Only a folder, no File item.
        {
          id: 503,
          fullname: `Software Testing (${SEM}_SEZG503)`,
          extraModules: [{ name: 'Course Handout', modname: 'folder', contextid: 8503 }],
        },
        {
          id: 504,
          fullname: `Agile (${SEM}_SEZG504)`,
          item: {
            name: 'Course Handout',
            contextid: 9504,
            files: [
              ...[{ filename: 'Course Handout.pdf', size: 900 }],
              { filename: 'Highway Engineering Lab (V-HEL)_v2 (2).pdf', size: 10 },
            ],
          },
        },
        {
          id: 601,
          fullname: `Introduction to Parallel and Distributed Programming (${SEM}_CCZG501)`,
          item: {
            name: 'Course Handout',
            contextid: 9601,
            files: [{ filename: 'Course Handout.pdf', size: 900 }],
          },
        },
        {
          id: 417,
          fullname: `Quantitative Methods | Business Statistics (Merged - MBAZC417/PDBAZC417/PDFTZC417/MBAZG501)(${SEM})`,
          item: {
            name: 'Course Handout',
            contextid: 9417,
            files: [{ filename: 'Course Handout.pdf', size: 900 }],
          },
        },
        // Taxila also keeps a single-code shell; a cross-listed handout must go to the merged one.
        { id: 418, fullname: `Quantitative Methods (${SEM}_MBAZC417)` },
        // MATH ZC222 deliberately has no Taxila course.
      ],
    });
  });

  test.afterAll(async () => {
    await fake?.close();
    // Publishing notifies faculty and writes audit rows; remove them with the handouts.
    for (const id of seeded) {
      await prisma.notification.deleteMany({ where: { link: { contains: id } } });
      await prisma.auditLog.deleteMany({ where: { OR: [{ requestId: id }, { entityId: id }] } });
    }
    await cleanupTestHandouts();
    // A finished bulk run tells the IC who started it; remove those notes with the runs.
    const runs = await prisma.taxilaPublishRun.findMany({
      where: { createdAt: { gte: started } },
      select: { id: true },
    });
    await prisma.notification.deleteMany({
      where: { link: { in: runs.map((r) => `/ic/taxila-runs/${r.id}`) } },
    });
    await prisma.taxilaPublishRun.deleteMany({ where: { createdAt: { gte: started } } });
  });

  test('check, then publish one handout: Course Handout.pdf replaces the placeholder', async ({
    browser,
  }) => {
    const id = await seedApproved('SE ZG501');
    const page = await asIc(browser);
    await page.goto(`/ic/requests/${id}`);
    await expect(page.getByTestId('taxila-semester-code')).toHaveValue(SEM);
    await expect(page.getByTestId('taxila-publish')).toHaveCount(0); // only after a passing check
    await page.getByTestId('taxila-check').click();
    const result = page.getByTestId('taxila-check-result');
    await expect(result).toHaveAttribute('data-status', 'ready');
    await expect(result).toContainText(`Software Engineering (${SEM}_SEZG501)`);
    await expect(result).toContainText('General › Course Handout');
    await expect(result).toContainText(
      'Ready to publish. It replaces the Course Handout.pdf there now.',
    );
    await expect(page.getByText('Publish as new version')).toHaveCount(0);
    expect(fake.calls.some((c) => c.step === 'upload')).toBe(false);

    await page.getByTestId('taxila-publish').click();
    // On success the page reloads into its Published state; the publish log names the file.
    await expect(page.locator('[data-status="PUBLISHED"]').first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText('Published to Taxila').first()).toBeVisible();
    await expect(page.getByText('“Course Handout.pdf”')).toBeVisible();
    const files = fake.courses.find((c) => c.id === 501)!.item!.files;
    expect(files.map((f) => f.filename)).toEqual(['Course Handout.pdf']);
    expect(files[0]!.size).toBeGreaterThan(1000); // a real PDF, not the placeholder
    // The move went to the File item, never the folder.
    const move = fake.calls.find((c) => c.step === 'move')!;
    expect(move.body).toContain('component=mod_resource');
    expect(move.body).toContain('contextid=9501');
    await page.context().close();
  });

  test('item missing; another file in the item blocks publishing', async ({ browser }) => {
    const missing = await seedApproved('SE ZG503');
    const blocked = await seedApproved('SE ZG504');
    const page = await asIc(browser);

    await page.goto(`/ic/requests/${missing}`);
    await page.getByTestId('taxila-check').click();
    const result = page.getByTestId('taxila-check-result');
    await expect(result).toHaveAttribute('data-status', 'item-missing');
    await expect(result).toContainText(
      "Create a File named 'Course Handout' in General with a placeholder named Course Handout.pdf, then check again.",
    );
    await expect(page.getByTestId('taxila-publish')).toHaveCount(0);

    const uploads = fake.calls.filter((c) => c.step === 'upload').length;
    await page.goto(`/ic/requests/${blocked}`);
    await page.getByTestId('taxila-check').click();
    await expect(result).toHaveAttribute('data-status', 'other-files');
    await expect(result).toContainText(
      "Remove 'Highway Engineering Lab (V-HEL)_v2 (2).pdf' from Course Handout first, so students see the published handout.",
    );
    await expect(page.getByTestId('taxila-other-files')).toContainText('Taxila opens the oldest');
    await expect(page.getByTestId('taxila-publish')).toHaveCount(0);
    expect(fake.calls.filter((c) => c.step === 'upload')).toHaveLength(uploads);

    // The IC removes the old file in Taxila and checks again: now it publishes.
    const item = fake.courses.find((c) => c.id === 504)!.item!;
    item.files = item.files.filter((f) => f.filename === 'Course Handout.pdf');
    await page.getByTestId('taxila-check').click();
    await expect(result).toHaveAttribute('data-status', 'ready');
    await page.getByTestId('taxila-publish').click();
    await expect(page.locator('[data-status="PUBLISHED"]').first()).toBeVisible({
      timeout: 60_000,
    });
    expect(item.files.map((f) => f.filename)).toEqual(['Course Handout.pdf']);
    await page.context().close();
  });

  test('bulk publish three: two published, one not found; Excel report', async ({ browser }) => {
    const ids = [
      await seedApproved('CC ZG501'),
      await seedApproved('MBA ZC417'),
      await seedApproved('MATH ZC222'),
    ];
    const page = await asIc(browser);
    await page.goto('/handouts?tab=published&view=not-published');
    await expect(page.getByTestId('bulk-publish-bar')).toBeVisible();
    for (const id of ids)
      await page.locator(`input[data-testid="bulk-select"][value="${id}"]`).check();
    await expect(page.getByTestId('bulk-publish-start')).toContainText('(3)');
    await page.getByTestId('bulk-semester-code').fill(SEM);
    await page.getByTestId('bulk-publish-start').click();
    await page.waitForURL(/\/ic\/taxila-runs\/c/);
    await expect(page.getByTestId('run-row')).toHaveCount(3);

    const uploadsBefore = fake.calls.filter((c) => c.step === 'upload').length;
    await page.getByTestId('run-check-all').click();
    await expect(page.getByTestId('run-progress')).toContainText('2 ready to publish', {
      timeout: 60_000,
    });
    expect(fake.calls.filter((c) => c.step === 'upload')).toHaveLength(uploadsBefore); // check uploads nothing

    await page.getByTestId('run-publish-all').click();
    await expect(page.getByTestId('run-progress')).toContainText('3 of 3 done', {
      timeout: 120_000,
    });
    // The run settles: a finished line, the buttons back to normal, the retry offered.
    await expect(page.getByTestId('run-finished')).toContainText(
      'Finished: 2 published, 1 needs attention',
    );
    await expect(page.getByTestId('run-progress')).not.toContainText('working');
    // Nothing left to check or publish, so those buttons go; retry and Excel stay.
    await expect(page.getByTestId('run-publish-all')).toHaveCount(0);
    await expect(page.getByTestId('run-check-all')).toHaveCount(0);
    await expect(page.getByTestId('run-retry')).toHaveText('Try the 1 problem course again');
    await expect(page.locator('[data-testid="run-row"][data-status="PUBLISHED"]')).toHaveCount(2);
    await expect(page.locator('[data-testid="run-row"][data-status="NOT_FOUND"]')).toContainText(
      'not found in Taxila',
    );
    const merged = fake.courses.find((c) => c.id === 417)!.item!.files;
    expect(merged.map((f) => f.filename)).toEqual(['Course Handout.pdf']);
    expect(merged[0]!.size).toBeGreaterThan(1000);
    const xlsx = await page.request.get(
      (await page.getByTestId('run-excel').getAttribute('href')) as string,
    );
    expect(xlsx.status()).toBe(200);
    expect(xlsx.headers()['content-type']).toContain('spreadsheetml');
    await page.context().close();
  });

  test('the token never reaches the browser', async ({ browser }) => {
    const id = await seedApproved('SE ZG501');
    const page = await asIc(browser);
    const bodies: string[] = [];
    page.on('response', async (r) => {
      try {
        bodies.push(await r.text());
      } catch {
        /* binary or closed */
      }
    });
    await page.goto(`/ic/requests/${id}`);
    await page.getByTestId('taxila-check').click();
    await expect(page.getByTestId('taxila-check-result')).toBeVisible();
    expect((await page.content()).includes(TOKEN)).toBe(false);
    expect(bodies.some((b) => b.includes(TOKEN))).toBe(false);
    await page.context().close();
  });
});

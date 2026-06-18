import { test, expect, type Page } from '@playwright/test';
import {
  prisma,
  HandoutStatus,
  ApprovalStage,
  ApprovalDecision,
  FacultyType,
  type Prisma,
} from '@hmp/db';
import { cleanupTestHandouts } from './fixtures/handout';

// Prompt 23-b — Word/PDF export download flow. Seeds an APPROVED handout WITH
// structured `data` (the export route 404s on legacy data:null handouts), using
// the HMP-8888- sentinel prefix so cleanupTestHandouts() tears it down.
// Word export runs anywhere; PDF needs LibreOffice → probe-tolerant.

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

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
    courseTitle: 'Export Test Course',
    courseNumbers: ['SE ZG501'],
    creditModel: { description: '3-1-1' },
    instructors: ['Dr. Export'],
    date: '01-08-2025',
    courseDescription: '<p>Export test description.</p>',
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

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password');
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
}

async function seedApprovedStructured(): Promise<string> {
  const [faculty, ic, hog, pc, offering] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { email: 'faculty@hmp.local' }, select: { id: true } }),
    prisma.user.findUniqueOrThrow({ where: { email: 'ic@hmp.local' }, select: { id: true } }),
    prisma.user.findUniqueOrThrow({ where: { email: 'hog@hmp.local' }, select: { id: true } }),
    prisma.user.findUniqueOrThrow({ where: { email: 'pc@hmp.local' }, select: { id: true } }),
    prisma.courseOffering.findFirstOrThrow({ orderBy: { createdAt: 'asc' }, select: { id: true } }),
  ]);
  const refNo = `HMP-8888-${process.hrtime.bigint().toString(36)}`;
  const req = await prisma.handoutRequest.create({
    data: {
      refNo,
      courseOfferingId: offering.id,
      initiatedById: ic.id,
      status: HandoutStatus.APPROVED,
      handout: { create: { status: HandoutStatus.APPROVED } },
      assignments: {
        create: { facultyId: faculty.id, facultyType: FacultyType.ON_CAMPUS, active: true },
      },
      approvals: {
        create: [
          {
            stage: ApprovalStage.HOG_REVIEW,
            decision: ApprovalDecision.APPROVED,
            reviewerId: hog.id,
            decidedAt: new Date(),
          },
          {
            stage: ApprovalStage.PC_REVIEW,
            decision: ApprovalDecision.APPROVED,
            reviewerId: pc.id,
            decidedAt: new Date(),
          },
          {
            stage: ApprovalStage.HOG_FINAL,
            decision: ApprovalDecision.APPROVED,
            reviewerId: hog.id,
            decidedAt: new Date(),
          },
        ],
      },
    },
    select: { id: true, handout: { select: { id: true } } },
  });
  const version = await prisma.handoutVersion.create({
    data: {
      handoutId: req.handout!.id,
      versionNo: 1,
      contentJson: {} as Prisma.InputJsonValue,
      contentHtml: '<p>legacy</p>',
      data: DATA as unknown as Prisma.InputJsonValue,
      authorId: faculty.id,
    },
  });
  await prisma.handout.update({
    where: { id: req.handout!.id },
    data: { currentVersionId: version.id },
  });
  return req.id;
}

test.describe('Word/PDF export download', () => {
  let requestId = '';
  test.beforeEach(async () => {
    requestId = await seedApprovedStructured();
  });
  test.afterEach(async () => {
    await cleanupTestHandouts();
  });

  test('IC sees the download menu and gets a valid .docx', async ({ page }) => {
    await signIn(page, 'ic@hmp.local');
    await page.goto(`/ic/requests/${requestId}`);
    await expect(page.getByTestId('download-menu')).toBeVisible();

    // Fetch via the browser context (carries the session cookie).
    const res = await page.request.get(`/api/handouts/${requestId}/export/docx`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toBe(DOCX_MIME);
    expect(res.headers()['content-disposition']).toMatch(
      /attachment; filename="HMP-8888-.*\.docx"/,
    );
    const body = await res.body();
    expect(body.length).toBeGreaterThan(1000);
    // .docx is a zip → starts with PK.
    expect(body.subarray(0, 2).toString('latin1')).toBe('PK');
  });

  test('PC sees NO download menu and is forbidden via the route', async ({ page }) => {
    await signIn(page, 'pc@hmp.local');
    await page.goto(`/pc/requests/${requestId}`);
    await expect(page.getByTestId('download-menu')).toHaveCount(0);
    const res = await page.request.get(`/api/handouts/${requestId}/export/docx`);
    expect(res.status()).toBe(403);
  });

  test('PDF export: 200 (LibreOffice present) or 503 (missing) — never 500', async ({ page }) => {
    await signIn(page, 'ic@hmp.local');
    const res = await page.request.get(`/api/handouts/${requestId}/export/pdf`);
    expect([200, 503]).toContain(res.status());
    if (res.status() === 200) {
      expect(res.headers()['content-type']).toBe('application/pdf');
      const body = await res.body();
      expect(body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    }
  });
});

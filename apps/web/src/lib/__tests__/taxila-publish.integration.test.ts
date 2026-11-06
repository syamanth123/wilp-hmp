import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma, HandoutStatus, RoleName, type Prisma } from '@hmp/db';
import { createTaxilaClient, type TaxilaConfig } from '@hmp/integrations';
import { startFakeMoodle, type FakeMoodle } from '@hmp/integrations/src/testing/fake-moodle';

// Publishing one handout into Taxila (v1.3.0, Mode C) against the fake Taxila — never the real
// one. DB-touching; skipped without DATABASE_URL. The PDF step is replaced (LibreOffice isn't on
// every machine; the browser test on CI uses the real one). Everything it creates is removed.

vi.mock('@/lib/export/handout-pdf', () => ({
  buildApprovedHandoutPdf: vi.fn(async () => Buffer.from('%PDF-1.4 test handout')),
}));

import { emailsSettled } from '../notifications';
import { loadPublishTarget, publishRequestToTaxila, checkRequestInTaxila } from '../taxila-publish';
import { createTaxilaRun, loadRun, processNextItem, retryProblemItems } from '../taxila-runs';

const hasDb = Boolean(process.env.DATABASE_URL);
const TAG = '__taxila_publish_test__';
const TOKEN = 'tok-INTEGRATION-9f8e7d6c5b4a';
const REF = 'HMP-7444-';

const DATA = {
  schemaVersion: 1,
  metadata: {
    institutionHeader: 'Birla Institute of Technology & Science, Pilani',
    divisionHeader: 'Work Integrated Learning Programmes Division',
    semester: 'First Semester 2026-2027',
    documentTitle: 'Course Handout',
    formNumber: '',
  },
  partA: {
    courseTitle: 'Taxila Test Course',
    courseNumbers: ['QTX ZG653'],
    creditModel: { description: '3-1-1' },
    instructors: ['Dr. Test'],
    date: '01-08-2026',
    courseDescription: '<p>Description.</p>',
    courseObjectives: [{ code: 'CO1', description: 'Understand' }],
    textBooks: [{ code: 'T1', citation: 'A book' }],
    referenceBooks: [],
    learningOutcomes: [{ code: 'LO1', description: 'Apply' }],
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

describe.skipIf(!hasDb)('publish one handout into Taxila (Mode C)', () => {
  let fake: FakeMoodle;
  let cfg: TaxilaConfig;
  let actor: { id: string; name: string; roles: RoleName[] };
  const ids: Record<string, string> = {};

  async function seedRequest(
    code: string,
    n: number,
    status: HandoutStatus = HandoutStatus.APPROVED,
  ) {
    const course = await prisma.course.create({
      data: { bitsCourseNumber: code, code, title: `Test ${code}` },
    });
    const offering = await prisma.courseOffering.create({
      data: { courseId: course.id, semesterId: ids.semester! },
    });
    const req = await prisma.handoutRequest.create({
      data: {
        refNo: `${REF}${String(n).padStart(4, '0')}`,
        courseOfferingId: offering.id,
        initiatedById: actor.id,
        status,
        handout: { create: { status } },
      },
      select: { id: true, handout: { select: { id: true } } },
    });
    const v = await prisma.handoutVersion.create({
      data: {
        handoutId: req.handout!.id,
        versionNo: 1,
        contentHtml: '',
        data: {
          ...DATA,
          partA: { ...DATA.partA, courseNumbers: [code] },
        } as unknown as Prisma.InputJsonValue,
        authorId: actor.id,
      },
    });
    await prisma.handout.update({
      where: { id: req.handout!.id },
      data: { currentVersionId: v.id },
    });
    return req.id;
  }

  beforeAll(async () => {
    const user = await prisma.user.upsert({
      where: { email: `${TAG}@hmp.local` },
      update: {},
      create: { email: `${TAG}@hmp.local`, name: 'Taxila Test IC' },
    });
    actor = { id: user.id, name: user.name, roles: [RoleName.INSTRUCTION_CELL] };
    const prog = await prisma.programme.create({
      data: {
        code: 'QTX-PROG',
        name: 'Taxila test',
        semesters: {
          create: {
            name: 'Sem-I 2026-27',
            year: 2026,
            term: 'FIRST',
            startDate: new Date('2026-08-01'),
            endDate: new Date('2026-12-15'),
          },
        },
      },
      include: { semesters: true },
    });
    ids.programme = prog.id;
    ids.semester = prog.semesters[0]!.id;
    fake = await startFakeMoodle({
      token: TOKEN,
      courses: [
        {
          id: 7001,
          fullname: 'Taxila Test (S1-26_QTXZG653)',
          item: {
            name: 'Course Handout',
            contextid: 8001,
            files: [{ filename: 'Course Handout.pdf', size: 900 }],
          },
        },
        { id: 7002, fullname: 'No Item (S1-26_QTXZG654)' },
        {
          id: 7003,
          fullname: 'Old File Too (S1-26_QTXZG655)',
          item: {
            name: 'Course Handout',
            contextid: 8003,
            files: [
              ...[{ filename: 'Course Handout.pdf', size: 900 }],
              { filename: 'QTX ZG655 Handout 2025.pdf', size: 9 },
            ],
          },
        },
      ],
    });
    cfg = {
      url: fake.url,
      token: TOKEN,
      timeoutMs: 5_000,
      backoffMs: [0, 0],
    };
    ids.ready = await seedRequest('QTX ZG653', 1);
    ids.noItem = await seedRequest('QTX ZG654', 2);
    ids.otherFiles = await seedRequest('QTX ZG655', 3);
    ids.draft = await seedRequest('QTX ZG656', 4, HandoutStatus.IN_PROGRESS);
  });

  afterAll(async () => {
    await emailsSettled();
    await fake?.close();
    const reqs = await prisma.handoutRequest.findMany({
      where: { refNo: { startsWith: REF } },
      select: { id: true },
    });
    const reqIds = reqs.map((r) => r.id);
    for (const id of reqIds)
      await prisma.notification.deleteMany({ where: { link: { contains: id } } });
    await prisma.auditLog.deleteMany({
      where: { OR: [{ requestId: { in: reqIds } }, { entityId: { in: reqIds } }] },
    });
    await prisma.handoutRequest.deleteMany({ where: { id: { in: reqIds } } });
    await prisma.courseOffering.deleteMany({ where: { semesterId: ids.semester } });
    await prisma.course.deleteMany({ where: { bitsCourseNumber: { startsWith: 'QTX ' } } });
    await prisma.programme.deleteMany({ where: { code: 'QTX-PROG' } });
    await prisma.taxilaPublishRun.deleteMany({ where: { createdById: actor?.id } });
    await prisma.notification.deleteMany({ where: { userId: actor?.id } });
    await prisma.user.deleteMany({ where: { email: `${TAG}@hmp.local` } });
  });

  const client = () => createTaxilaClient(cfg);
  const target = async (id: string) => (await loadPublishTarget(id))!;

  it('Check in Taxila uploads nothing', async () => {
    const view = await checkRequestInTaxila(
      await target(ids.ready!),
      { semesterCode: 'S1-26' },
      client(),
      cfg,
    );
    expect(view.check.status).toBe('ready');
    expect(view.fileName).toBe('Course Handout.pdf');
    expect(fake.calls.some((c) => c.step === 'upload')).toBe(false);
  });

  it('publishes: Course Handout.pdf replaces the placeholder, handout PUBLISHED, log has the HMP reference and Taxila course id', async () => {
    const out = await publishRequestToTaxila(
      await target(ids.ready!),
      { semesterCode: 'S1-26', actor },
      client(),
      cfg,
    );
    expect(out).toMatchObject({
      status: 'published',
      fileName: 'Course Handout.pdf',
      message: 'Published to Taxila: “Course Handout.pdf” in Course Handout.',
    });
    const files = fake.courses[0]!.item!.files;
    expect(files.map((f) => f.filename)).toEqual(['Course Handout.pdf']);
    // The handout's PDF (mocked above), not the 900-byte placeholder.
    expect(files[0]!.size).toBe(Buffer.byteLength('%PDF-1.4 test handout'));
    const req = await prisma.handoutRequest.findUniqueOrThrow({
      where: { id: ids.ready },
      include: { handout: { include: { publishLogs: true } }, approvals: true },
    });
    expect(req.status).toBe(HandoutStatus.PUBLISHED);
    expect(req.approvals.some((a) => a.stage === 'IC_PUBLISH')).toBe(true);
    const log = req.handout!.publishLogs[0]!;
    expect(log).toMatchObject({ status: 'success', mode: 'TAXILA_FOLDER' });
    expect(log.externalRef).toMatch(/course\/view\.php\?id=7001$/);
    expect(log.responseJson).toMatchObject({
      refNo: `${REF}0001`,
      taxilaCourseId: 7001,
      semesterCode: 'S1-26',
      item: 'Course Handout',
      fileName: 'Course Handout.pdf',
      size: files[0]!.size,
      replaced: true,
    });
  });

  it('publishing again is refused — no second upload', async () => {
    const uploads = fake.calls.filter((c) => c.step === 'upload').length;
    const out = await publishRequestToTaxila(
      await target(ids.ready!),
      { semesterCode: 'S1-26', actor },
      client(),
      cfg,
    );
    expect(out).toMatchObject({ status: 'not-approved', message: 'Already published.' });
    expect(fake.calls.filter((c) => c.step === 'upload').length).toBe(uploads);
  });

  it('a handout that isn’t approved is never published', async () => {
    const out = await publishRequestToTaxila(
      await target(ids.draft!),
      { semesterCode: 'S1-26', actor },
      client(),
      cfg,
    );
    expect(out.status).toBe('not-approved');
  });

  it('item missing: nothing uploaded, still approved, the failure is logged with its step', async () => {
    const out = await publishRequestToTaxila(
      await target(ids.noItem!),
      { semesterCode: 'S1-26', actor },
      client(),
      cfg,
    );
    expect(out).toMatchObject({
      status: 'item-missing',
      message:
        "Create a File named 'Course Handout' in General with a placeholder named Course Handout.pdf, then check again.",
    });
    const req = await prisma.handoutRequest.findUniqueOrThrow({
      where: { id: ids.noItem },
      include: { handout: { include: { publishLogs: true } } },
    });
    expect(req.status).toBe(HandoutStatus.APPROVED);
    expect(req.handout!.publishLogs[0]).toMatchObject({ status: 'failed', mode: 'TAXILA_FOLDER' });
    expect(req.handout!.publishLogs[0]!.responseJson).toMatchObject({
      step: 'item',
      refNo: `${REF}0002`,
    });
  });

  it('another file in the item blocks it: nothing uploaded, still approved; once removed, it publishes', async () => {
    const before = fake.calls.filter((c) => c.step === 'upload').length;
    const out = await publishRequestToTaxila(
      await target(ids.otherFiles!),
      { semesterCode: 'S1-26', actor },
      client(),
      cfg,
    );
    expect(out).toMatchObject({
      status: 'other-files',
      message:
        "Remove 'QTX ZG655 Handout 2025.pdf' from Course Handout first, so students see the published handout.",
    });
    expect(fake.calls.filter((c) => c.step === 'upload').length).toBe(before);
    expect((await target(ids.otherFiles!)).status).toBe(HandoutStatus.APPROVED);

    // The IC removes the old file in Taxila, then publishes.
    const handoutItem = fake.courses[2]!.item!;
    handoutItem.files = handoutItem.files.filter((f) => f.filename === 'Course Handout.pdf');
    const ok = await publishRequestToTaxila(
      await target(ids.otherFiles!),
      { semesterCode: 'S1-26', actor },
      client(),
      cfg,
    );
    expect(ok.status).toBe('published');
    expect(handoutItem.files.map((f) => f.filename)).toEqual(['Course Handout.pdf']);
  });

  it('a publish Taxila doesn’t confirm stays approved and is logged as failed', async () => {
    const id = await seedRequest('QTX ZG660', 5);
    fake.courses.push({
      id: 7005,
      fullname: 'Unconfirmed (S1-26_QTXZG660)',
      item: {
        name: 'Course Handout',
        contextid: 8005,
        files: [{ filename: 'Course Handout.pdf', size: 900 }],
      },
    });
    fake.failures.move = 'move-no-effect';
    try {
      const out = await publishRequestToTaxila(
        await target(id),
        { semesterCode: 'S1-26', actor },
        client(),
        cfg,
      );
      expect(out).toMatchObject({ status: 'failed', step: 'verify' });
      expect(out.message).toMatch(
        /^Uploaded, but the Course Handout.pdf in Taxila isn't the new file/,
      );
    } finally {
      fake.failures = {};
    }
    const req = await prisma.handoutRequest.findUniqueOrThrow({
      where: { id },
      include: { handout: { include: { publishLogs: true } } },
    });
    expect(req.status).toBe(HandoutStatus.APPROVED);
    expect(req.handout!.publishLogs[0]).toMatchObject({ status: 'failed' });
    expect(req.handout!.publishLogs[0]!.responseJson).toMatchObject({ step: 'verify' });
  });

  describe('bulk run (one course at a time, resumable)', () => {
    it('check uploads nothing; publish goes on past a failure; a second tab resumes without double-publishing', async () => {
      const a = await seedRequest('QTX ZG657', 11);
      const b = await seedRequest('QTX ZG658', 12); // no Course Handout item
      const c = await seedRequest('QTX ZG659', 13);
      fake.courses.push(
        {
          id: 7011,
          fullname: 'Bulk A (S1-26_QTXZG657)',
          item: {
            name: 'Course Handout',
            contextid: 8011,
            files: [{ filename: 'Course Handout.pdf', size: 900 }],
          },
        },
        { id: 7012, fullname: 'Bulk B, no item (S1-26_QTXZG658)' },
        {
          id: 7013,
          fullname: 'Bulk C (S1-26_QTXZG659)',
          item: {
            name: 'Course Handout',
            contextid: 8013,
            files: [{ filename: 'Course Handout.pdf', size: 900 }],
          },
        },
      );
      const created = await createTaxilaRun({
        actorId: actor.id,
        semesterCode: 'S1-26',
        requestIds: [a, b, c, ids.draft!],
      });
      expect(created.ok).toBe(true);
      const runId = (created as { runId: string }).runId;
      const run0 = (await loadRun(runId))!;
      expect(run0.rows.map((r) => r.refNo)).toEqual([`${REF}0011`, `${REF}0012`, `${REF}0013`]); // the draft isn't approved

      const searches = fake.calls.filter((x) => x.step === 'search').length;
      const uploads = fake.calls.filter((x) => x.step === 'upload').length;
      while (!(await processNextItem(runId, 'check', actor, client(), cfg)).done);
      let rows = (await loadRun(runId))!.rows;
      expect(rows.map((r) => r.status)).toEqual(['READY', 'ITEM_MISSING', 'READY']);
      expect(fake.calls.filter((x) => x.step === 'upload').length).toBe(uploads);
      expect(fake.calls.filter((x) => x.step === 'search').length).toBe(searches + 1); // one search per run

      // Publish one course, then "close the tab"; a second tab carries on.
      await processNextItem(runId, 'publish', actor, client(), cfg);
      expect((await loadRun(runId))!.rows[0]!.status).toBe('PUBLISHED');
      // The last course and "finished" come in the same answer — the page settles at once.
      const last = await processNextItem(runId, 'publish', actor, client(), cfg);
      expect(last.done).toBe(true);
      expect(last.itemId).toBeTruthy();
      rows = (await loadRun(runId))!.rows;
      expect(rows.map((r) => r.status)).toEqual(['PUBLISHED', 'ITEM_MISSING', 'PUBLISHED']);
      expect((await loadRun(runId))!.status).toBe('DONE');
      // The IC who started it gets one summary (in HMP and by email).
      const summaries = () =>
        prisma.notification.findMany({
          where: { userId: actor.id, link: `/ic/taxila-runs/${runId}` },
          select: { channel: true, subject: true },
        });
      expect((await summaries()).map((n) => n.channel).sort()).toEqual(['EMAIL', 'IN_PORTAL']);
      expect((await summaries())[0]!.subject).toBe(
        'Bulk publish to Taxila finished: 2 published, 1 needs attention',
      );
      // Asking again changes nothing and sends nothing more.
      expect((await processNextItem(runId, 'publish', actor, client(), cfg)).done).toBe(true);
      expect(await summaries()).toHaveLength(2);
      expect(fake.courses.find((x) => x.id === 7011)!.item!.files).toHaveLength(1);
      expect(fake.courses.find((x) => x.id === 7013)!.item!.files).toHaveLength(1);
      expect(
        await prisma.handoutRequest.count({
          where: { id: { in: [a, c] }, status: HandoutStatus.PUBLISHED },
        }),
      ).toBe(2);

      // IC creates the missing item; "try the problem courses again" publishes just that one.
      fake.courses.find((x) => x.id === 7012)!.item = {
        name: 'Course Handout',
        contextid: 8012,
        files: [{ filename: 'Course Handout.pdf', size: 900 }],
      };
      expect(await retryProblemItems(runId)).toBe(1);
      while (!(await processNextItem(runId, 'publish', actor, client(), cfg)).done);
      rows = (await loadRun(runId))!.rows;
      expect(rows.map((r) => r.status)).toEqual(['PUBLISHED', 'PUBLISHED', 'PUBLISHED']);
      expect(await summaries()).toHaveLength(4); // a second finish, a second summary
      for (const id of [7011, 7012, 7013])
        expect(fake.courses.find((x) => x.id === id)!.item!.files).toHaveLength(1);
    });
  });

  it('the token is in no database row HMP wrote', async () => {
    const reqs = await prisma.handoutRequest.findMany({
      where: { refNo: { startsWith: REF } },
      select: { id: true, handout: { select: { id: true } } },
    });
    const logs = await prisma.lmsPublishLog.findMany({
      where: { handoutId: { in: reqs.map((r) => r.handout!.id) } },
    });
    const audits = await prisma.auditLog.findMany({
      where: { requestId: { in: reqs.map((r) => r.id) } },
    });
    expect(logs.length).toBeGreaterThan(2);
    expect(JSON.stringify([logs, audits])).not.toContain(TOKEN);
  });
});

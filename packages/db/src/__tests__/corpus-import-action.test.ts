import { describe, it, expect, beforeEach, afterEach, afterAll, beforeAll } from 'vitest';
import { existsSync, mkdtempSync, copyFileSync, rmSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Prisma, PrismaClient } from '@prisma/client';
import { runCorpusImport, processSingleHandoutFile } from '../corpus-import/import-action';
import { parseDibbaDocx } from '../dibba-import/parser';
import {
  createAcademicTerm,
  createDibbaImport,
  discardDibbaImport,
  matchCourseCodes,
  publishDibbaImport,
  DibbaError,
} from '../dibba-import/import-action';
import type { DibbaRow } from '../dibba-import/types';

/**
 * Integration test for runCorpusImport (Prompt 11f-a). Copies the 5
 * synthetic fixtures into a temp directory, runs the import against a real
 * Prisma client, asserts the summary breakdown matches the per-fixture
 * expected extractionMethod, then verifies idempotency by re-running.
 *
 * Probe-skips if the Postgres URL isn't reachable (same convention as the
 * other integration suites).
 */

const fixturesDir = join(__dirname, '..', '__fixtures__', 'corpus-samples');

const FIXTURES = [
  'f1-standard.docx',
  'f2-hhsm-swap.docx',
  'f3-module-template.docx',
  'f4-modular-content.docx',
  'f5-malformed.docx',
];

const fixturesReady = FIXTURES.every((f) => existsSync(join(fixturesDir, f)));

const prisma = new PrismaClient();

let dbReachable = false;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    // not reachable — probe-skip below
  }

  if (!fixturesReady) {
    console.warn(
      '[corpus-import-action.test] Fixtures missing — run `pnpm --filter @hmp/db fixture:generate`.',
    );
  }
  if (!dbReachable) {
    console.warn(
      '[corpus-import-action.test] Postgres unreachable — probe-skipping integration tests.',
    );
  }
});

// We can't use the dbReachable check at describe-time (it runs before
// beforeAll). Use `it.skipIf` per-test instead so the probe-skip only
// applies when DB / fixtures aren't ready.
const skipReason = () =>
  !fixturesReady ? 'fixtures missing' : !dbReachable ? 'postgres unreachable' : null;
const suite = describe;

suite('runCorpusImport — integration', () => {
  let tempCorpus: string;
  // Use a unique prefix per test run to avoid collisions on parallel CI workers.
  const TEST_PREFIX = `corpus-test-${process.pid}-${Date.now()}`;

  beforeEach(() => {
    if (skipReason()) return; // probe-skipped
    tempCorpus = mkdtempSync(join(tmpdir(), 'hmp-corpus-test-'));
    for (const f of FIXTURES) {
      copyFileSync(join(fixturesDir, f), join(tempCorpus, `${TEST_PREFIX}-${f}`));
    }
  });

  afterEach(async () => {
    if (skipReason()) return;
    rmSync(tempCorpus, { recursive: true, force: true });
    await prisma.handoutImport.deleteMany({
      where: { sourceFile: { contains: TEST_PREFIX } },
    });
  });

  const integ = (name: string, fn: () => Promise<void> | void) => {
    it(name, async () => {
      const reason = skipReason();
      if (reason) {
        console.warn(`[corpus-import-action.test] skipping "${name}": ${reason}`);
        return;
      }
      await fn();
    });
  };

  integ('produces the expected breakdown across the 5 fixtures', async () => {
    const summary = await runCorpusImport(prisma, tempCorpus);
    expect(summary.scanned).toBe(5);
    // 11f-b2: f3 (Module template) now produces data via honest-empty
    // mapping; succeeded count includes f1, f2, f3, f4 (was f1, f2, f4 in
    // 11f-a/b1 when f3 was SKIPPED_MODULE).
    expect(summary.succeeded).toBe(4);
    expect(summary.failed).toBe(1); // f5
    expect(summary.skippedModule).toBe(0); // f3 no longer skipped
    expect(summary.skippedSize).toBe(0);
    expect(summary.skippedFormat).toBe(0);
    expect(summary.unchanged).toBe(0); // first run, nothing in DB
  });

  integ(
    'writes upsert rows with the correct extractionMethod and course-number columns',
    async () => {
      await runCorpusImport(prisma, tempCorpus);
      const rows = await prisma.handoutImport.findMany({
        where: { sourceFile: { contains: TEST_PREFIX } },
        orderBy: { sourceFile: 'asc' },
      });
      expect(rows).toHaveLength(5);

      const byBasename = Object.fromEntries(
        rows.map((r) => [r.sourceFile.split(/[\\/]/).pop()!.replace(`${TEST_PREFIX}-`, ''), r]),
      );

      expect(byBasename['f1-standard.docx']!.extractionMethod).toBe('MAMMOTH_STRUCTURED');
      expect(byBasename['f1-standard.docx']!.bitsCourseNumber).toBe('SE ZG501');
      expect(byBasename['f1-standard.docx']!.data).not.toBeNull();

      expect(byBasename['f2-hhsm-swap.docx']!.extractionMethod).toBe('MAMMOTH_STRUCTURED');
      expect(byBasename['f2-hhsm-swap.docx']!.bitsCourseNumber).toBe('HHSM ZG999');
      expect(byBasename['f2-hhsm-swap.docx']!.parseWarnings.some((w) => /swap/i.test(w))).toBe(
        true,
      );

      // 11f-b2: Module template now produces MAMMOTH_STRUCTURED with
      // honest-empty CO/LO arrays (schema relaxed) + populated Part A
      // + parseWarnings naming the source gap.
      expect(byBasename['f3-module-template.docx']!.extractionMethod).toBe('MAMMOTH_STRUCTURED');
      expect(byBasename['f3-module-template.docx']!.data).not.toBeNull();
      expect(byBasename['f3-module-template.docx']!.bitsCourseNumber).toBe('EE ZG999');

      expect(byBasename['f4-modular-content.docx']!.extractionMethod).toBe('MAMMOTH_STRUCTURED');
      expect(
        byBasename['f4-modular-content.docx']!.parseWarnings.some((w) =>
          /Modular Content/i.test(w),
        ),
      ).toBe(true);

      expect(byBasename['f5-malformed.docx']!.extractionMethod).toBe('FAILED');
      expect(byBasename['f5-malformed.docx']!.data).toBeNull();
    },
  );

  integ('is idempotent — re-running on the same files reports unchanged=5', async () => {
    await runCorpusImport(prisma, tempCorpus);
    const second = await runCorpusImport(prisma, tempCorpus);
    expect(second.scanned).toBe(5);
    expect(second.unchanged).toBe(5);
    expect(second.succeeded).toBe(0);
    expect(second.failed).toBe(0);
  });

  integ(
    'preserves approvedForReuse across re-imports (admin approval is not reset on re-parse)',
    async () => {
      await runCorpusImport(prisma, tempCorpus);
      const target = await prisma.handoutImport.findFirst({
        where: {
          sourceFile: { contains: TEST_PREFIX },
          extractionMethod: 'MAMMOTH_STRUCTURED',
        },
      });
      expect(target).not.toBeNull();
      await prisma.handoutImport.update({
        where: { id: target!.id },
        data: { approvedForReuse: true, approvedAt: new Date() },
      });

      // Touch the file mtime so the upsert path forces re-parse.
      const now = new Date();
      utimesSync(target!.sourceFile, now, now);
      await runCorpusImport(prisma, tempCorpus);

      const after = await prisma.handoutImport.findUnique({ where: { id: target!.id } });
      expect(after!.approvedForReuse).toBe(true); // preserved
      expect(after!.approvedAt).not.toBeNull();
    },
  );

  // Prompt 24 — single-file admin import. Lives here (vs a new test file with its
  // own PrismaClient) to avoid adding parallel-DB contention to the integration
  // suite (the documented Prompt 15 race). Reuses this suite's prisma + cleanup.
  integ('processSingleHandoutFile imports one .docx → unapproved row (Prompt 24)', async () => {
    const key = `${TEST_PREFIX}-single.docx`;
    const tmp = join(tempCorpus, key);
    copyFileSync(join(fixturesDir, 'f1-standard.docx'), tmp);
    const res = await processSingleHandoutFile(prisma, {
      filePath: tmp,
      originalName: key,
      sizeBytes: 100_000,
    });
    expect(res.importId).toBeTruthy();
    expect(['MAMMOTH_STRUCTURED', 'TEXT_FALLBACK', 'FAILED']).toContain(res.extractionMethod);
    const row = await prisma.handoutImport.findUnique({ where: { sourceFile: key } });
    expect(row).not.toBeNull();
    expect(row?.approvedForReuse).toBe(false); // imports land unapproved
  });
});

// ---------------------------------------------------------------------------
// Course Dibba Phase 3 — persistence / publish / discard / term core.
// Lives in THIS file, as a sibling describe, to honour the one-PrismaClient-
// per-test-file rule (docs/dev-handoff-audit.md: a second client in a new
// @hmp/db file raced apps/web's suites twice). It reuses the module-level
// `prisma` and the dbReachable probe, has its own skip reason (it does not
// need the corpus fixtures), and every row it writes carries a per-run
// sentinel and is deleted by id/prefix. The uploader User deliberately has NO
// role rows, so apps/web's bulk-create test (which findFirst()s an
// INSTRUCTION_CELL user) can never pick it up.
// ---------------------------------------------------------------------------
const DIBBA_DOCX = join(__dirname, '..', '__fixtures__', 'dibba', 'course-dibba-2025-s1.docx');
const RUN = `${process.pid}-${Date.now()}`;
const SENTINEL_YEAR = 9000 + (Date.now() % 1000);
const TERM_NAME = `DIBBA-TEST-${RUN}`;
const USER_EMAIL = `dibba-test-${RUN}@test.local`;
const COURSE_1 = `DBT-${RUN}-1`;
const COURSE_2 = `DBT-${RUN}-2`;
const COURSE_2_ALT = `DBTALT-${RUN}`;

const dibbaSkipReason = () =>
  !dbReachable ? 'postgres unreachable' : !existsSync(DIBBA_DOCX) ? 'dibba fixture missing' : null;

/** Loud per-test skip: Vitest reports SKIPPED (not a green no-op) and the reason is in the log. */
const integDibba = (name: string, fn: () => Promise<void>) =>
  it(
    name,
    async (ctx) => {
      const reason = dibbaSkipReason();
      if (reason) {
        console.warn(`[corpus-import-action.test / dibba] skipping "${name}": ${reason}`);
        return ctx.skip();
      }
      await fn();
    },
    60_000,
  );

async function purgeDibbaSentinels(): Promise<void> {
  // Restrict FKs: imports (entries cascade) before terms; audit rows before the user.
  await prisma.dibbaImport.deleteMany({ where: { term: { name: { startsWith: 'DIBBA-TEST-' } } } });
  await prisma.academicTerm.deleteMany({ where: { name: { startsWith: 'DIBBA-TEST-' } } });
  const users = await prisma.user.findMany({
    where: { email: { startsWith: 'dibba-test-' } },
    select: { id: true },
  });
  if (users.length) {
    await prisma.auditLog.deleteMany({ where: { actorId: { in: users.map((u) => u.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
  }
  await prisma.course.deleteMany({ where: { bitsCourseNumber: { startsWith: 'DBT-' } } });
}

describe('dibba-import (Phase 3) — create / publish / discard / term', () => {
  let termId = '';
  let userId = '';
  let courseId1 = '';
  let courseId2 = '';

  const syntheticRows = (): DibbaRow[] => [
    {
      programmeCode: 'HT01',
      programmeTitle: 'HT01 M.Tech. (Embedded System)',
      admitBatch: '2/2024',
      isNewAdmission: false,
      isBacklogRow: false,
      studentCount: 50,
      slotNo: 1,
      slotDay: 'SAT',
      slotSession: 'FN',
      courseCode: COURSE_1,
      courseTitle: 'ONE',
      courseType: 'CORE',
      erpCourseId: null,
      classTimeHint: null,
      remarks: null,
      rawCell: `${COURSE_1}|ONE`,
    },
    {
      programmeCode: 'HT01',
      programmeTitle: 'HT01 M.Tech. (Embedded System)',
      admitBatch: '2/2024',
      isNewAdmission: false,
      isBacklogRow: false,
      studentCount: 50,
      slotNo: 2,
      slotDay: 'SAT',
      slotSession: 'AN',
      courseCode: COURSE_2_ALT, // links through alternateCodes
      courseTitle: 'TWO',
      courseType: 'ELECTIVE',
      erpCourseId: null,
      classTimeHint: null,
      remarks: null,
      rawCell: `${COURSE_2_ALT}|TWO`,
    },
    {
      programmeCode: 'HT01',
      programmeTitle: 'HT01 M.Tech. (Embedded System)',
      admitBatch: '2/2024',
      isNewAdmission: false,
      isBacklogRow: false,
      studentCount: 50,
      slotNo: 3,
      slotDay: 'SUN',
      slotSession: 'FN',
      courseCode: `NOPE-${RUN}`, // not in the catalogue
      courseTitle: 'THREE',
      courseType: 'UNSPECIFIED',
      erpCourseId: null,
      classTimeHint: null,
      remarks: null,
      rawCell: `NOPE-${RUN}|THREE`,
    },
  ];

  const createImport = (label: string, rows: DibbaRow[] = syntheticRows()) =>
    createDibbaImport(prisma, {
      termId,
      label,
      sourceFilename: 'synthetic.docx',
      sourceFormat: 'docx',
      uploadedById: userId,
      rows,
      warnings: ['w1', 'w2'],
    });

  beforeAll(async () => {
    if (dibbaSkipReason()) return;
    await purgeDibbaSentinels();
    const user = await prisma.user.create({
      data: { email: USER_EMAIL, name: 'Dibba Test', active: true },
      select: { id: true },
    });
    userId = user.id;
    const [c1, c2] = await Promise.all([
      prisma.course.create({
        data: { bitsCourseNumber: COURSE_1, code: COURSE_1, title: 'ONE' },
        select: { id: true },
      }),
      prisma.course.create({
        data: {
          bitsCourseNumber: COURSE_2,
          code: COURSE_2,
          title: 'TWO',
          alternateCodes: [COURSE_2_ALT],
        },
        select: { id: true },
      }),
    ]);
    courseId1 = c1.id;
    courseId2 = c2.id;
    const term = await createAcademicTerm(prisma, {
      name: TERM_NAME,
      year: SENTINEL_YEAR,
      term: 'FIRST',
      startDate: new Date(`${SENTINEL_YEAR}-08-01`),
      endDate: new Date(`${SENTINEL_YEAR}-12-15`),
      actorId: userId,
    }).then((r) => r.termId);
    termId = term;
  }, 60_000); // real DB work (purge + create term in a transaction); Vitest's hook default is 10 s

  afterAll(async () => {
    if (dibbaSkipReason()) return;
    await purgeDibbaSentinels(); // cascades the 1,077-entry import
  }, 60_000);

  integDibba('createAcademicTerm seeds the 8 standard slots and writes an audit row', async () => {
    const slots = await prisma.slotTiming.findMany({
      where: { termId },
      orderBy: { slotNo: 'asc' },
    });
    expect(slots.map((s) => `${s.slotNo}:${s.day} ${s.session}`)).toEqual([
      '1:SAT FN',
      '2:SAT AN',
      '3:SUN FN',
      '4:SUN AN',
      '5:FRI FN',
      '6:FRI AN',
      '7:SAT EV',
      '8:SUN EV',
    ]);
    const audit = await prisma.auditLog.findFirst({
      where: { entity: 'AcademicTerm', entityId: termId, action: 'dibba.term.create' },
    });
    expect(audit?.actorId).toBe(userId);
  });

  integDibba(
    'a second term for the same (year, term) is refused by the core AND by the unique index',
    async () => {
      await expect(
        createAcademicTerm(prisma, {
          name: `${TERM_NAME}-dup`,
          year: SENTINEL_YEAR,
          term: 'FIRST',
          startDate: new Date(`${SENTINEL_YEAR}-08-01`),
          endDate: new Date(`${SENTINEL_YEAR}-12-15`),
          actorId: userId,
        }),
      ).rejects.toMatchObject({ name: 'DibbaError', code: 'term_exists' });
      // The index itself (Phase 3 migration): bypass the pre-check.
      await expect(
        prisma.academicTerm.create({
          data: {
            name: `${TERM_NAME}-dup2`,
            year: SENTINEL_YEAR,
            term: 'FIRST',
            startDate: new Date(),
            endDate: new Date(),
          },
        }),
      ).rejects.toSatisfy(
        (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002',
      );
    },
  );

  integDibba(
    'matchCourseCodes: bitsCourseNumber first, then alternateCodes, else unmatched',
    async () => {
      const courses = await prisma.course.findMany({
        where: { bitsCourseNumber: { in: [COURSE_1, COURSE_2] } },
        select: { id: true, bitsCourseNumber: true, alternateCodes: true },
      });
      const link = matchCourseCodes([COURSE_1, COURSE_2_ALT, `NOPE-${RUN}`], courses);
      expect(link.get(COURSE_1)).toBe(courseId1);
      expect(link.get(COURSE_2_ALT)).toBe(courseId2);
      expect(link.has(`NOPE-${RUN}`)).toBe(false);
    },
  );

  integDibba(
    'createDibbaImport writes a DRAFT with entries, links courseId, counts unknown codes',
    async () => {
      const res = await createImport('synthetic A');
      expect(res).toMatchObject({ rowCount: 3, warningCount: 2, unknownCodeCount: 1 });
      const imp = await prisma.dibbaImport.findUnique({
        where: { id: res.importId },
        include: { entries: { orderBy: { slotNo: 'asc' } } },
      });
      expect(imp).toMatchObject({
        status: 'DRAFT',
        rowCount: 3,
        warnings: ['w1', 'w2'],
        publishedAt: null,
      });
      expect(imp!.entries.map((e) => e.courseId)).toEqual([courseId1, courseId2, null]);
      expect(imp!.entries[1]).toMatchObject({
        courseType: 'ELECTIVE',
        slotDay: 'SAT',
        slotSession: 'AN',
      });
    },
  );

  integDibba(
    'the committed 2025 fixture persists as 1,077 entries with its 5 warnings',
    async () => {
      const parsed = await parseDibbaDocx({ path: DIBBA_DOCX });
      const res = await createDibbaImport(prisma, {
        termId,
        label: 'As on 02.07.2025',
        sourceFilename: 'course-dibba-2025-s1.docx',
        sourceFormat: 'docx',
        uploadedById: userId,
        rows: parsed.rows,
        warnings: parsed.warnings,
      });
      expect(res.rowCount).toBe(1077);
      expect(res.warningCount).toBe(5);
      expect(await prisma.dibbaEntry.count({ where: { importId: res.importId } })).toBe(1077);
      expect(
        await prisma.dibbaEntry.count({
          where: { importId: res.importId, slotNo: { gte: 1, lte: 8 } },
        }),
      ).toBe(1077);
    },
  );

  integDibba(
    'publish: DRAFT → PUBLISHED; a second publish supersedes the first, keeping its publishedAt',
    async () => {
      const a = await createImport('A');
      const b = await createImport('B');
      const pa = await publishDibbaImport(prisma, { importId: a.importId, actorId: userId });
      expect(pa.supersededIds).toEqual([]);
      const pb = await publishDibbaImport(prisma, { importId: b.importId, actorId: userId });
      expect(pb.supersededIds).toEqual([a.importId]);
      const [ra, rb] = await Promise.all([
        prisma.dibbaImport.findUniqueOrThrow({ where: { id: a.importId } }),
        prisma.dibbaImport.findUniqueOrThrow({ where: { id: b.importId } }),
      ]);
      expect(ra.status).toBe('SUPERSEDED');
      expect(ra.publishedAt).toEqual(pa.publishedAt); // historical stamp kept
      expect(rb.status).toBe('PUBLISHED');
      expect(rb.publishedAt).toEqual(pb.publishedAt);
      const audit = await prisma.auditLog.findFirst({
        where: { entity: 'DibbaImport', entityId: b.importId, action: 'dibba.import.publish' },
      });
      expect(audit?.actorId).toBe(userId);
      expect(audit?.before).toMatchObject({
        status: 'DRAFT',
        superseded: [{ id: a.importId, label: 'A' }],
      });
      expect(await prisma.dibbaImport.count({ where: { termId, status: 'PUBLISHED' } })).toBe(1);
    },
  );

  integDibba('publishing a non-DRAFT import throws not_draft and changes nothing', async () => {
    const published = await prisma.dibbaImport.findFirstOrThrow({
      where: { termId, status: 'PUBLISHED' },
    });
    const before = await prisma.dibbaImport.findMany({ where: { termId }, orderBy: { id: 'asc' } });
    await expect(
      publishDibbaImport(prisma, { importId: published.id, actorId: userId }),
    ).rejects.toMatchObject({ name: 'DibbaError', code: 'not_draft' });
    await expect(
      publishDibbaImport(prisma, { importId: 'clzzzzzzzzzzzzzzzzzzzzzzz', actorId: userId }),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(
      await prisma.dibbaImport.findMany({ where: { termId }, orderBy: { id: 'asc' } }),
    ).toEqual(before);
  });

  integDibba('two concurrent publishes for the same term leave exactly one PUBLISHED', async () => {
    const [c, d] = await Promise.all([createImport('C'), createImport('D')]);
    const results = await Promise.allSettled([
      publishDibbaImport(prisma, { importId: c.importId, actorId: userId }),
      publishDibbaImport(prisma, { importId: d.importId, actorId: userId }),
    ]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']); // serialized by the term lock
    expect(await prisma.dibbaImport.count({ where: { termId, status: 'PUBLISHED' } })).toBe(1);
    expect(
      await prisma.dibbaImport.count({
        where: { id: { in: [c.importId, d.importId] }, status: 'SUPERSEDED' },
      }),
    ).toBe(1);
  });

  integDibba(
    'discard: deletes a DRAFT (entries cascade) with an audit row; refuses a PUBLISHED import',
    async () => {
      const e = await createImport('E');
      const res = await discardDibbaImport(prisma, { importId: e.importId, actorId: userId });
      expect(res.termId).toBe(termId);
      expect(await prisma.dibbaImport.findUnique({ where: { id: e.importId } })).toBeNull();
      expect(await prisma.dibbaEntry.count({ where: { importId: e.importId } })).toBe(0);
      const audit = await prisma.auditLog.findFirst({
        where: { entity: 'DibbaImport', entityId: e.importId, action: 'dibba.import.discard' },
      });
      expect(audit?.actorId).toBe(userId);
      expect(audit?.before).toMatchObject({ status: 'DRAFT', label: 'E', rowCount: 3 });
      const published = await prisma.dibbaImport.findFirstOrThrow({
        where: { termId, status: 'PUBLISHED' },
      });
      await expect(
        discardDibbaImport(prisma, { importId: published.id, actorId: userId }),
      ).rejects.toMatchObject({ code: 'not_draft' });
      expect(await prisma.dibbaImport.findUnique({ where: { id: published.id } })).not.toBeNull();
    },
  );

  integDibba(
    'publish racing discard on the same draft: exactly one wins, the live schedule survives',
    async () => {
      const f = await createImport('F');
      const results = await Promise.allSettled([
        publishDibbaImport(prisma, { importId: f.importId, actorId: userId }),
        discardDibbaImport(prisma, { importId: f.importId, actorId: userId }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const loser = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(loser.reason).toBeInstanceOf(DibbaError);
      expect(await prisma.dibbaImport.count({ where: { termId, status: 'PUBLISHED' } })).toBe(1);
    },
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});

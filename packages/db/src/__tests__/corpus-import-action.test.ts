import { describe, it, expect, beforeEach, afterEach, afterAll, beforeAll } from 'vitest';
import { existsSync, mkdtempSync, copyFileSync, rmSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PrismaClient } from '@prisma/client';
import { runCorpusImport } from '../corpus-import/import-action';

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
    expect(summary.succeeded).toBe(3); // f1, f2, f4 produce data
    expect(summary.failed).toBe(1); // f5
    expect(summary.skippedModule).toBe(1); // f3
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

      expect(byBasename['f3-module-template.docx']!.extractionMethod).toBe('SKIPPED_MODULE');
      expect(byBasename['f3-module-template.docx']!.data).toBeNull();
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
});

afterAll(async () => {
  await prisma.$disconnect();
});

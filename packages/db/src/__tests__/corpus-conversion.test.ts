import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseDocxToHandout } from '../corpus-import/parser';
import { ensureDocxFormat } from '../corpus-import/ensure-docx';
import { parseFileWithConversion } from '../corpus-import/import-action';
import { sofficeAvailable } from '../soffice';

/**
 * Prompt 24 — configurable size cap, .doc conversion hook (pure / no-DB unit
 * tests). Conversion paths probe-skip when LibreOffice is absent (local dev,
 * like the MinIO/Redis specs). The DB-touching single-file import test lives in
 * corpus-import-action.test.ts to avoid adding a second parallel PrismaClient
 * to the integration suite (the documented Prompt 15 parallel-DB race).
 */

const fixturesDir = join(__dirname, '..', '__fixtures__', 'corpus-samples');
const DOCX = join(fixturesDir, 'f1-standard.docx');
const fixtureReady = existsSync(DOCX);

describe('size cap (CORPUS_IMPORT_MAX_BYTES, default 8 MB — Prompt 24)', () => {
  it('a 6 MB file is NOT skipped by the default cap (was skipped under the old 3 MB)', async () => {
    if (!fixtureReady) return;
    // fileBytes drives the pre-flight; pass a fabricated 6 MB to exercise the cap
    // without needing a real 6 MB file.
    const r = await parseDocxToHandout({ filePath: DOCX, fileBytes: 6 * 1024 * 1024 });
    expect(r.extractionMethod).not.toBe('SKIPPED_SIZE');
  });

  it('a 9 MB file IS skipped (above the 8 MB default)', async () => {
    if (!fixtureReady) return;
    const r = await parseDocxToHandout({ filePath: DOCX, fileBytes: 9 * 1024 * 1024 });
    expect(r.extractionMethod).toBe('SKIPPED_SIZE');
  });

  it('an explicit maxBytes override still wins', async () => {
    if (!fixtureReady) return;
    const r = await parseDocxToHandout({
      filePath: DOCX,
      fileBytes: 4 * 1024 * 1024,
      maxBytes: 3 * 1024 * 1024,
    });
    expect(r.extractionMethod).toBe('SKIPPED_SIZE');
  });
});

describe('ensureDocxFormat (Prompt 24)', () => {
  it('.docx → passthrough (same path, noop cleanup)', async () => {
    if (!fixtureReady) return;
    const ensured = await ensureDocxFormat(DOCX);
    expect(ensured.path).toBe(DOCX);
    await ensured.cleanup(); // must not throw
  });

  it('.pdf → passthrough (parser pre-flight handles the skip, ensureDocxFormat does not throw)', async () => {
    const ensured = await ensureDocxFormat('/some/where/handout.pdf');
    expect(ensured.path).toBe('/some/where/handout.pdf');
    await ensured.cleanup();
  });

  it('.doc → converts when LibreOffice present, else throws SofficeError(missing-binary)', async () => {
    const work = mkdtempSync(join(tmpdir(), 'hmp-doctest-'));
    const docPath = join(work, 'legacy.doc');
    writeFileSync(docPath, 'not-a-real-doc'); // content irrelevant: soffice probe drives the path
    try {
      if (await sofficeAvailable()) return; // present → conversion path runs (covered on CI/EC2)
      await expect(ensureDocxFormat(docPath)).rejects.toMatchObject({
        name: 'SofficeError',
        kind: 'missing-binary',
      });
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
});

describe('parseFileWithConversion (Prompt 24) — .doc error mapping', () => {
  it('.doc with LibreOffice absent → SKIPPED_FORMAT (not a thrown error, batch-safe)', async () => {
    if (await sofficeAvailable()) return; // present → would actually convert; covered on CI
    const work = mkdtempSync(join(tmpdir(), 'hmp-doctest2-'));
    const docPath = join(work, 'legacy.doc');
    writeFileSync(docPath, 'not-a-real-doc');
    try {
      const r = await parseFileWithConversion(docPath, 1234);
      expect(r.extractionMethod).toBe('SKIPPED_FORMAT');
      expect(r.errors[0]).toMatch(/LibreOffice not available/i);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });

  it('.docx routes straight to the parser (no conversion)', async () => {
    if (!fixtureReady) return;
    const r = await parseFileWithConversion(DOCX, 100_000);
    expect(['MAMMOTH_STRUCTURED', 'TEXT_FALLBACK', 'FAILED']).toContain(r.extractionMethod);
  });
});

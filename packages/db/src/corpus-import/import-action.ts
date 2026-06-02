import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Prisma, type PrismaClient } from '@prisma/client';
import { parseDocxToHandout } from './parser';

/**
 * Idempotent corpus import (Prompt 11f-a). Scans a directory for `.docx`,
 * `.doc`, and `.pdf` files; for each, parses (or skips) via
 * `parseDocxToHandout` and upserts a `HandoutImport` row keyed on
 * `sourceFile`.
 *
 * Idempotency: re-running on a file with unchanged `(bytes, mtime)` is a
 * no-op. A changed file forces re-parse via the upsert path.
 *
 * Runs inline. Per the Phase 2 plan: 384 files × ~50-150 ms each is 20-60 s,
 * borderline acceptable for an admin-triggered action. Queue later if it
 * turns out too slow in practice.
 */

export interface ImportSummary {
  scanned: number;
  succeeded: number; // MAMMOTH_STRUCTURED or TEXT_FALLBACK with data != null
  failed: number; // FAILED (parser ran, data is null)
  skippedSize: number; // SKIPPED_SIZE
  skippedFormat: number; // SKIPPED_FORMAT (.doc, .pdf)
  skippedModule: number; // SKIPPED_MODULE (EE-style Course Modules template)
  unchanged: number; // idempotent skip — bytes+mtime match an existing row
  durationMs: number;
}

export interface ImportOptions {
  /** Optional override for the size cap (default 3 MB). */
  maxBytes?: number;
  /**
   * Cap the number of files scanned. Useful for tests / dry-runs against
   * the real corpus without spending the full 20-60s.
   */
  limit?: number;
  /**
   * Optional per-file progress callback. Fires AFTER each file completes
   * (parsed or skipped). Useful for piping into a streaming admin UI later.
   */
  onProgress?: (file: string, methodOrUnchanged: string) => void;
}

const SKIP_PREFIXES = ['~$', '.']; // Word lock files, hidden files

export async function runCorpusImport(
  prisma: PrismaClient,
  corpusPath: string,
  options: ImportOptions = {},
): Promise<ImportSummary> {
  const startedAt = Date.now();
  const entries = await readdir(corpusPath);
  const candidates = entries
    .filter((name) => !SKIP_PREFIXES.some((p) => name.startsWith(p)))
    .filter((name) => /\.(docx|doc|pdf)$/i.test(name))
    .slice(0, options.limit ?? Infinity);

  const summary: ImportSummary = {
    scanned: 0,
    succeeded: 0,
    failed: 0,
    skippedSize: 0,
    skippedFormat: 0,
    skippedModule: 0,
    unchanged: 0,
    durationMs: 0,
  };

  for (const name of candidates) {
    summary.scanned++;
    const fullPath = join(corpusPath, name);
    const st = await stat(fullPath);
    const sourceFile = fullPath;
    const sourceFileBytes = st.size;
    const sourceModifiedAt = st.mtime;

    // Idempotency check
    const existing = await prisma.handoutImport.findUnique({ where: { sourceFile } });
    if (
      existing &&
      existing.sourceFileBytes === sourceFileBytes &&
      existing.sourceModifiedAt.getTime() === sourceModifiedAt.getTime()
    ) {
      summary.unchanged++;
      options.onProgress?.(name, 'UNCHANGED');
      continue;
    }

    // Parse (or skip per pre-flight)
    const result = await parseDocxToHandout({
      filePath: fullPath,
      fileBytes: sourceFileBytes,
      maxBytes: options.maxBytes,
    });

    await prisma.handoutImport.upsert({
      where: { sourceFile },
      create: {
        sourceFile,
        sourceFileBytes,
        sourceModifiedAt,
        bitsCourseNumber: result.bitsCourseNumber,
        alternateCodes: result.alternateCodes,
        data: result.data ? (result.data as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        parseWarnings: result.warnings,
        parseErrors: result.errors,
        extractionMethod: result.extractionMethod,
      },
      update: {
        sourceFileBytes,
        sourceModifiedAt,
        bitsCourseNumber: result.bitsCourseNumber,
        alternateCodes: result.alternateCodes,
        data: result.data ? (result.data as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        parseWarnings: result.warnings,
        parseErrors: result.errors,
        extractionMethod: result.extractionMethod,
        // approvedForReuse / approvedById / approvedAt are NOT reset on
        // re-parse; admin's approval decision persists across re-imports
        // unless explicitly revoked via the 11f-b approval UI.
      },
    });

    // Tally
    switch (result.extractionMethod) {
      case 'MAMMOTH_STRUCTURED':
      case 'TEXT_FALLBACK':
        if (result.data) summary.succeeded++;
        else summary.failed++; // Tier 2 produced bitsCourseNumber only, no data
        break;
      case 'FAILED':
        summary.failed++;
        break;
      case 'SKIPPED_SIZE':
        summary.skippedSize++;
        break;
      case 'SKIPPED_FORMAT':
        summary.skippedFormat++;
        break;
      case 'SKIPPED_MODULE':
        summary.skippedModule++;
        break;
    }

    options.onProgress?.(name, result.extractionMethod);
  }

  summary.durationMs = Date.now() - startedAt;
  return summary;
}

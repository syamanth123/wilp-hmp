import { readdir, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { Prisma, type PrismaClient } from '@prisma/client';
import { parseDocxToHandout, type ParseResult, type CorpusExtractionMethod } from './parser';
import { ensureDocxFormat } from './ensure-docx';
import { SofficeError } from '../soffice';

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
  /** Optional override for the size cap (default `CORPUS_IMPORT_MAX_BYTES` or 8 MB). */
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

/**
 * Parse a source file, converting `.doc` → `.docx` first (Prompt 24). Shared by
 * the batch loop AND the single-file admin path so the conversion + error
 * mapping can't drift. A `.doc` whose conversion fails maps to SKIPPED_FORMAT
 * (LibreOffice missing) or FAILED (conversion error) — never throws to the
 * caller, so a bad file can't halt a batch.
 */
export async function parseFileWithConversion(
  sourceFile: string,
  fileBytes: number,
  maxBytes?: number,
): Promise<ParseResult> {
  if (extname(sourceFile).toLowerCase() !== '.doc') {
    return parseDocxToHandout({ filePath: sourceFile, fileBytes, maxBytes });
  }
  let ensured;
  try {
    ensured = await ensureDocxFormat(sourceFile);
  } catch (err) {
    if (err instanceof SofficeError) {
      const missing = err.kind === 'missing-binary';
      return {
        data: null,
        warnings: [],
        errors: [
          missing
            ? 'LibreOffice not available to convert .doc — install libreoffice or set SOFFICE_BIN.'
            : `.doc → .docx conversion failed (${err.kind}).`,
        ],
        bitsCourseNumber: null,
        alternateCodes: [],
        extractionMethod: missing ? 'SKIPPED_FORMAT' : 'FAILED',
      };
    }
    throw err;
  }
  try {
    const st = await stat(ensured.path);
    return await parseDocxToHandout({ filePath: ensured.path, fileBytes: st.size, maxBytes });
  } finally {
    await ensured.cleanup();
  }
}

/**
 * Shared HandoutImport upsert (Prompt 24 — extracted so the batch + single-file
 * paths can't drift in field handling / conflict resolution). `approvedForReuse`
 * + approver fields are intentionally NOT touched on update: an admin's approval
 * decision persists across re-imports.
 */
export async function upsertImportRow(
  prisma: PrismaClient,
  args: {
    sourceFile: string;
    sourceFileBytes: number;
    sourceModifiedAt: Date;
    result: ParseResult;
  },
): Promise<string> {
  const { sourceFile, sourceFileBytes, sourceModifiedAt, result } = args;
  const data = result.data ? (result.data as unknown as Prisma.InputJsonValue) : Prisma.JsonNull;
  const common = {
    sourceFileBytes,
    sourceModifiedAt,
    bitsCourseNumber: result.bitsCourseNumber,
    alternateCodes: result.alternateCodes,
    data,
    parseWarnings: result.warnings,
    parseErrors: result.errors,
    extractionMethod: result.extractionMethod,
  };
  const row = await prisma.handoutImport.upsert({
    where: { sourceFile },
    create: { sourceFile, ...common },
    update: common,
    select: { id: true },
  });
  return row.id;
}

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

    // Parse (.doc auto-converts to .docx first; or skip per pre-flight).
    const result = await parseFileWithConversion(fullPath, sourceFileBytes, options.maxBytes);

    await upsertImportRow(prisma, { sourceFile, sourceFileBytes, sourceModifiedAt, result });

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

export interface SingleImportResult {
  importId: string;
  extractionMethod: CorpusExtractionMethod;
  hasData: boolean;
  warnings: string[];
  errors: string[];
  bitsCourseNumber: string | null;
}

/**
 * Import ONE handout file (Prompt 24 — admin manual upload). Single-purpose:
 * no directory scan, no idempotency-by-mtime (each upload re-imports). Routes
 * through the SAME `parseFileWithConversion` + `upsertImportRow` as the batch
 * path so they can't drift. The DB key is the ORIGINAL filename (re-uploading
 * the same name updates its row); `filePath` is the temp file to parse (its
 * extension drives `.doc` conversion).
 */
export async function processSingleHandoutFile(
  prisma: PrismaClient,
  args: { filePath: string; originalName: string; sizeBytes: number; maxBytes?: number },
): Promise<SingleImportResult> {
  const result = await parseFileWithConversion(args.filePath, args.sizeBytes, args.maxBytes);
  const importId = await upsertImportRow(prisma, {
    sourceFile: args.originalName,
    sourceFileBytes: args.sizeBytes,
    sourceModifiedAt: new Date(),
    result,
  });
  return {
    importId,
    extractionMethod: result.extractionMethod,
    hasData: result.data != null,
    warnings: result.warnings,
    errors: result.errors,
    bitsCourseNumber: result.bitsCourseNumber,
  };
}

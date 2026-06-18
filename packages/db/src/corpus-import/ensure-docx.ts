import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { convertViaSoffice } from '../soffice';

/**
 * Ensure a source file is in `.docx` form before the parser runs (Prompt 24).
 * The parser ([parser.ts]) is pure (no subprocess); format conversion is an
 * orchestration concern, so it lives here and is called by the import loop +
 * the single-file admin path BEFORE `parseDocxToHandout`.
 *
 *   - `.docx` → passthrough (no temp, noop cleanup).
 *   - `.doc`  → convert to `.docx` via LibreOffice ([../soffice]); write the
 *               result to a temp file and return its path + a cleanup. May throw
 *               `SofficeError` (missing-binary / conversion-failed) — the caller
 *               maps that to SKIPPED_FORMAT / FAILED.
 *   - anything else (e.g. `.pdf`) → passthrough; the parser's pre-flight already
 *               records it as SKIPPED_FORMAT. (We deliberately do NOT throw
 *               "unsupported" here — that would turn the corpus's 1 `.pdf` from a
 *               clean skip into an error.)
 */
export interface EnsuredDocx {
  path: string;
  cleanup: () => Promise<void>;
}

const NOOP_CLEANUP = async () => undefined;

export async function ensureDocxFormat(inputPath: string): Promise<EnsuredDocx> {
  const ext = extname(inputPath).toLowerCase();
  if (ext !== '.doc') {
    // .docx (and .pdf / other) pass through unchanged.
    return { path: inputPath, cleanup: NOOP_CLEANUP };
  }
  // .doc → LibreOffice convert to .docx. convertViaSoffice manages its own temp
  // dir; we write its output to a second temp dir so the parser has a path.
  const docxBytes = await convertViaSoffice(await readFile(inputPath), 'doc', 'docx');
  const work = await mkdtemp(join(tmpdir(), 'hmp-doc2docx-'));
  const outPath = join(work, 'converted.docx');
  await writeFile(outPath, docxBytes);
  return {
    path: outPath,
    cleanup: async () => {
      await rm(work, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}

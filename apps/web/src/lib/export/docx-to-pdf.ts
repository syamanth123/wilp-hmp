import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * docx → PDF via LibreOffice headless (Prompt 23-b, Decision 1 — EC2 deploy).
 *
 * Operational hardening:
 *   - **Per-invocation `UserInstallation`** (a unique temp profile dir) — without
 *     this, concurrent conversions collide on LibreOffice's default profile lock
 *     and hang. See docs/dev-handoff-audit.md.
 *   - **30s timeout → SIGKILL** — covers a stalled conversion or a wedged guard.
 *   - **Temp cleanup** in `finally` (input docx, output pdf, profile dir).
 *   - Binary path via `SOFFICE_BIN` (default `soffice`); ENOENT → ExportError so
 *     the caller can surface a clean 503 (LibreOffice not installed — the local
 *     dev case, like MinIO; runs in CI/EC2 where LibreOffice is present).
 */

const SOFFICE_BIN = process.env.SOFFICE_BIN || 'soffice';
const TIMEOUT_MS = 30_000;

export class PdfConversionError extends Error {
  constructor(
    message: string,
    public readonly kind: 'missing-binary' | 'timeout' | 'conversion-failed',
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'PdfConversionError';
  }
}

function runSoffice(profileDir: string, outDir: string, inputPath: string): Promise<void> {
  const userInstallation = pathToFileURL(profileDir).href; // file:///… per-invocation profile
  const args = [
    '--headless',
    '--norestore',
    `-env:UserInstallation=${userInstallation}`,
    '--convert-to',
    'pdf',
    '--outdir',
    outDir,
    inputPath,
  ];
  return new Promise<void>((resolve, reject) => {
    const child = spawn(SOFFICE_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new PdfConversionError(`LibreOffice timed out after ${TIMEOUT_MS}ms`, 'timeout'));
    }, TIMEOUT_MS);

    child.stderr?.on('data', (d) => {
      stderr += String(d);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(
          new PdfConversionError(
            `LibreOffice binary not found (${SOFFICE_BIN}). Set SOFFICE_BIN or install libreoffice.`,
            'missing-binary',
            err,
          ),
        );
      } else {
        reject(new PdfConversionError('Failed to spawn LibreOffice', 'conversion-failed', err));
      }
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else
        reject(
          new PdfConversionError(`LibreOffice exited with code ${code}`, 'conversion-failed', {
            code,
            stderr: stderr.slice(0, 2048),
          }),
        );
    });
  });
}

/**
 * Convert a .docx buffer to a PDF buffer. Throws `PdfConversionError` on
 * missing binary / timeout / conversion failure (no path leakage in `message`).
 */
export async function docxToPdf(docx: Buffer): Promise<Buffer> {
  const work = await mkdtemp(join(tmpdir(), 'hmp-export-'));
  const profileDir = join(work, 'lo-profile');
  const inputPath = join(work, 'handout.docx');
  const outputPath = join(work, 'handout.pdf');
  try {
    await writeFile(inputPath, docx);
    await runSoffice(profileDir, work, inputPath);
    return await readFile(outputPath);
  } catch (err) {
    if (err instanceof PdfConversionError) throw err;
    throw new PdfConversionError('PDF conversion failed', 'conversion-failed', err);
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Probe whether LibreOffice is invocable (used by tests to skip locally). */
export async function libreOfficeAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(SOFFICE_BIN, ['--version'], { stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

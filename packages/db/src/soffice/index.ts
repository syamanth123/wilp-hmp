import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Shared LibreOffice headless conversion (Prompt 24 — extracted from Prompt
 * 23-b's docx-to-pdf so the PDF export AND the corpus `.doc`→`.docx` import
 * share ONE hardened subprocess path. Server-only (child_process/fs) — imported
 * across the package boundary the same way `@hmp/db/src/corpus-import` is.
 *
 * Lives in `@hmp/db` (not `@hmp/integrations`) because `@hmp/integrations`
 * depends on `@hmp/db`; a helper there would create a cycle for the corpus
 * (db-side) caller. `@hmp/db` is the only leaf both consumers already import.
 *
 * Operational hardening (do not strip):
 *   - **Per-invocation `UserInstallation`** (unique temp profile) — concurrent
 *     conversions otherwise collide on LibreOffice's default profile lock and
 *     hang.
 *   - **30s timeout → SIGKILL** — stalled conversion or wedged guard.
 *   - **Temp cleanup** in `finally`.
 *   - `SOFFICE_BIN` env (default `soffice`); ENOENT → `missing-binary` so callers
 *     map it to a clean 503 (local dev / no LibreOffice, like MinIO).
 */

const SOFFICE_BIN = process.env.SOFFICE_BIN || 'soffice';
const TIMEOUT_MS = 30_000;

export type SofficeErrorKind = 'missing-binary' | 'timeout' | 'conversion-failed';

export class SofficeError extends Error {
  constructor(
    message: string,
    public readonly kind: SofficeErrorKind,
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'SofficeError';
  }
}

/** Low-level hardened spawn. `convertTo` is the LibreOffice target filter (`pdf`/`docx`). */
function runSoffice(
  profileDir: string,
  outDir: string,
  inputPath: string,
  convertTo: string,
): Promise<void> {
  const userInstallation = pathToFileURL(profileDir).href; // file:///… per-invocation profile
  const args = [
    '--headless',
    '--norestore',
    `-env:UserInstallation=${userInstallation}`,
    '--convert-to',
    convertTo,
    '--outdir',
    outDir,
    inputPath,
  ];
  return new Promise<void>((resolve, reject) => {
    const child = spawn(SOFFICE_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new SofficeError(`LibreOffice timed out after ${TIMEOUT_MS}ms`, 'timeout'));
    }, TIMEOUT_MS);

    child.stderr?.on('data', (d) => {
      stderr += String(d);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(
          new SofficeError(
            `LibreOffice binary not found (${SOFFICE_BIN}). Set SOFFICE_BIN or install libreoffice.`,
            'missing-binary',
            err,
          ),
        );
      } else {
        reject(new SofficeError('Failed to spawn LibreOffice', 'conversion-failed', err));
      }
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else
        reject(
          new SofficeError(`LibreOffice exited with code ${code}`, 'conversion-failed', {
            code,
            stderr: stderr.slice(0, 2048),
          }),
        );
    });
  });
}

/**
 * Convert a document buffer from one format to another via LibreOffice.
 * @param input  source bytes
 * @param from   source extension WITHOUT the dot (e.g. `docx`, `doc`)
 * @param to     LibreOffice target filter (`pdf` | `docx`)
 * Throws `SofficeError` (no path leakage in `message`).
 */
export async function convertViaSoffice(
  input: Buffer,
  from: string,
  to: 'pdf' | 'docx',
): Promise<Buffer> {
  const work = await mkdtemp(join(tmpdir(), 'hmp-soffice-'));
  const profileDir = join(work, 'lo-profile');
  const inputPath = join(work, `source.${from}`);
  const outputPath = join(work, `source.${to}`);
  try {
    await writeFile(inputPath, input);
    await runSoffice(profileDir, work, inputPath, to);
    return await readFile(outputPath);
  } catch (err) {
    if (err instanceof SofficeError) throw err;
    throw new SofficeError('Document conversion failed', 'conversion-failed', err);
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Probe whether LibreOffice is invocable (used by tests to probe-skip locally). */
export async function sofficeAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(SOFFICE_BIN, ['--version'], { stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

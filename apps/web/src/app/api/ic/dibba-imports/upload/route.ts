import { writeFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma, RoleName } from '@hmp/db';
import { getSessionUser, hasRole } from '@hmp/auth';
import { ensureDocxFormat, type EnsuredDocx } from '@hmp/db/src/corpus-import';
import { SofficeError } from '@hmp/db/src/soffice';
import {
  createDibbaImport,
  parseDibbaDocx,
  parseDibbaXlsxDetailed,
  xlsxRowToDibbaRow,
  type DibbaRow,
  type DibbaSourceFormat,
} from '@hmp/db/src/dibba-import';
import { audit } from '@/lib/audit';
import { rateLimit, tooManyRequests, RATE_LIMITS } from '@/lib/rate-limit';
import {
  DIBBA_MAX_ROWS,
  deriveDibbaLabel,
  safeSourceFilename,
  validateDibbaUpload,
  type DibbaUploadExt,
} from '@/app/ic/dibba/upload-validation';

export const dynamic = 'force-dynamic';

/**
 * IC Course Dibba upload (Phase 3, docs/plans/phase-3-course-dibba.md §3). A
 * Route Handler — NOT a server action — because uploads are body-capped at
 * `serverActions.bodySizeLimit` and only a handler owns both the size ceiling
 * and the error body. Converts (.doc → .docx via LibreOffice), parses, caps,
 * then persists ONE DRAFT DibbaImport with all its entries and redirects the
 * client to the preview. Nothing is written until every check has passed, and
 * the parsed rows are stored exactly once (re-uploading creates a new DRAFT).
 *
 * Order of checks (cheap/pure before any DB round-trip): origin → session →
 * role → rate limit → multipart → termId shape → extension/size → term exists
 * → convert/parse → row caps → write → audit.
 */
export async function POST(req: Request) {
  // CSRF defense-in-depth (Prompt 20) — same Origin/Host check as the other
  // upload routes, but fail-closed on an Origin that will not parse: browsers
  // send the literal `Origin: null` from sandboxed iframes / file:// pages, and
  // `new URL('null')` throws — above the handler's try/catch that would be a
  // bare 500, not the 403 this check exists to return. A wholly absent Origin
  // is still allowed (same-origin non-browser callers, the tests).
  const origin = req.headers.get('origin');
  if (origin !== null) {
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    const host = req.headers.get('host');
    if (originHost === null || host === null || originHost !== host) {
      return Response.json({ error: 'bad_origin' }, { status: 403 });
    }
  }

  // Explicit checks, NOT requireRole (it throws → 500 in a Route Handler).
  // hasRole carries the ADMIN bypass, matching requireRole's semantics.
  const me = await getSessionUser();
  if (!me) return Response.json({ error: 'unauthenticated' }, { status: 401 });
  if (!hasRole(me, RoleName.INSTRUCTION_CELL)) {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }

  // This path spawns LibreOffice, so unlike the corpus route it is throttled. Fail-open.
  const rl = await rateLimit(
    `dibba-upload:${me.id}`,
    RATE_LIMITS.upload.limit,
    RATE_LIMITS.upload.windowSec,
  );
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: 'invalid_multipart' }, { status: 400 });
  }
  const file = form.get('file');
  if (!(file instanceof File)) {
    return Response.json({ error: 'no_file' }, { status: 400 });
  }
  const termId = z.string().cuid().safeParse(form.get('termId'));
  if (!termId.success) {
    return Response.json({ error: 'invalid_term' }, { status: 400 });
  }

  const valid = validateDibbaUpload({ name: file.name, size: file.size });
  if (!valid.ok) {
    const status =
      valid.code === 'unsupported_format' ? 415 : valid.code === 'file_too_large' ? 413 : 400;
    return Response.json({ error: valid.code, detail: valid.message }, { status });
  }

  const term = await prisma.academicTerm.findUnique({
    where: { id: termId.data },
    select: { id: true },
  });
  if (!term) return Response.json({ error: 'term_not_found' }, { status: 404 });

  const sourceFilename = safeSourceFilename(file.name);
  const label = (String(form.get('label') ?? '').trim() || deriveDibbaLabel(file.name)).slice(
    0,
    120,
  );

  const started = Date.now();
  const timing = { convertMs: 0, parseMs: 0, writeMs: 0 };
  const work = await mkdtemp(join(tmpdir(), 'hmp-dibba-'));
  let ensured: EnsuredDocx | undefined;
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    let parsed: Parsed;
    try {
      parsed = await parseUpload(valid.ext, bytes, work, timing, (e) => {
        ensured = e;
      });
    } catch (err) {
      return parseErrorResponse(err, valid.ext, sourceFilename);
    }

    if (parsed.rows.length === 0) {
      return Response.json(
        { error: 'no_rows', detail: 'No course rows were found in this file.' },
        { status: 422 },
      );
    }
    if (parsed.rows.length > DIBBA_MAX_ROWS) {
      return Response.json(
        {
          error: 'too_many_rows',
          detail: `${parsed.rows.length} rows exceeds the ${DIBBA_MAX_ROWS}-row limit.`,
        },
        { status: 422 },
      );
    }

    const t = Date.now();
    const result = await createDibbaImport(prisma, {
      termId: term.id,
      label,
      sourceFilename,
      sourceFormat: valid.ext.slice(1) as DibbaSourceFormat,
      uploadedById: me.id,
      rows: parsed.rows,
      warnings: parsed.warnings,
    });
    timing.writeMs = Date.now() - t;

    // Own error boundary: an audit failure after a successful import must not
    // turn into a 500 that invites a second upload (the corpus route's flaw).
    try {
      await audit({
        actorId: me.id,
        action: 'dibba.import.upload',
        entity: 'DibbaImport',
        entityId: result.importId,
        after: {
          termId: term.id,
          label,
          sourceFilename,
          sourceFormat: valid.ext.slice(1),
          rowCount: result.rowCount,
          warningCount: result.warningCount,
          unknownCodeCount: result.unknownCodeCount,
          tableCount: parsed.tableCount,
          sheetRowCount: parsed.sheetRowCount,
        },
      });
    } catch (auditErr) {
      console.error('[dibba-upload] audit failed', { importId: result.importId, auditErr });
    }
    // Conversion time on the server is the number to watch against the 30 s
    // soffice SIGKILL. Object form (like every other log here): util.inspect
    // escapes the caller-controlled name, so it cannot forge a log line.
    console.info('[dibba-upload] done', {
      name: sourceFilename,
      convertMs: timing.convertMs,
      parseMs: timing.parseMs,
      writeMs: timing.writeMs,
      rows: result.rowCount,
      totalMs: Date.now() - started,
    });
    return Response.json(
      { ok: true, ...result, tableCount: parsed.tableCount, sheetRowCount: parsed.sheetRowCount },
      { status: 200 },
    );
  } catch (err) {
    console.error('[dibba-upload] processing failed', { name: sourceFilename, err });
    return Response.json({ error: 'processing_failed' }, { status: 500 });
  } finally {
    // Total and non-throwing: `ensured` exists only after a successful .doc conversion.
    await ensured?.cleanup().catch(() => undefined);
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}

interface Parsed {
  rows: DibbaRow[];
  warnings: string[];
  /** docx grid count; null for xlsx. Not persisted — response + audit only. */
  tableCount: number | null;
  /** xlsx rows read (blank rows included); null for doc/docx. */
  sheetRowCount: number | null;
}

async function parseUpload(
  ext: DibbaUploadExt,
  bytes: Buffer,
  work: string,
  timing: { convertMs: number; parseMs: number },
  onEnsured: (e: EnsuredDocx) => void,
): Promise<Parsed> {
  if (ext === '.doc') {
    // Only the .doc path touches disk — named from a UUID + the VALIDATED
    // extension, never file.name (ensureDocxFormat branches on the extension).
    const tmpPath = join(work, `${randomUUID()}${ext}`);
    await writeFile(tmpPath, bytes);
    let t = Date.now();
    const ensured = await ensureDocxFormat(tmpPath);
    onEnsured(ensured);
    timing.convertMs = Date.now() - t;
    t = Date.now();
    const parsed = await parseDibbaDocx({ path: ensured.path });
    timing.parseMs = Date.now() - t;
    return { ...parsed, sheetRowCount: null };
  }
  const t = Date.now();
  if (ext === '.docx') {
    const parsed = await parseDibbaDocx({ buffer: bytes });
    timing.parseMs = Date.now() - t;
    return { ...parsed, sheetRowCount: null };
  }
  const sheet = await parseDibbaXlsxDetailed({ buffer: bytes });
  timing.parseMs = Date.now() - t;
  return {
    rows: sheet.rows.map(xlsxRowToDibbaRow),
    warnings: sheet.warnings,
    tableCount: null,
    sheetRowCount: sheet.sheetRowCount,
  };
}

/** Conversion / parse failures are the IC's problem to fix (4xx), never a 500; nothing was written. */
function parseErrorResponse(err: unknown, ext: DibbaUploadExt, name: string): Response {
  if (err instanceof SofficeError) {
    if (err.kind === 'missing-binary') {
      return Response.json(
        {
          error: 'converter_unavailable',
          detail:
            'LibreOffice not available to convert .doc — install libreoffice or set SOFFICE_BIN.',
        },
        { status: 503 },
      );
    }
    if (err.kind === 'timeout') {
      return Response.json(
        {
          error: 'conversion_timeout',
          detail:
            'Converting the .doc took too long — try again, or save it as .docx and upload that.',
        },
        { status: 504 },
      );
    }
    // stderr stays in the server log; the client gets a plain explanation.
    console.error('[dibba-upload] conversion failed', { name, detail: err.detail });
    return Response.json(
      {
        error: 'conversion_failed',
        detail:
          'LibreOffice could not convert this .doc file. Save it as .docx in Word and upload that.',
      },
      { status: 422 },
    );
  }
  console.error('[dibba-upload] parse failed', { name, err });
  const message = err instanceof Error ? err.message : '';
  // The xlsx reader's own messages ("No "Course Dibba …" sheet found; sheets: …",
  // "… missing column(s): …") are user-facing and path-free; anything else gets
  // a generic line so internal messages never reach the client.
  const detail =
    ext === '.xlsx' && /Course Dibba|missing column/.test(message)
      ? message
      : ext === '.xlsx'
        ? 'Not a readable .xlsx workbook.'
        : ext === '.docx'
          ? 'Not a valid .docx file.'
          : 'The converted document could not be read.';
  return Response.json({ error: 'parse_failed', detail }, { status: 422 });
}

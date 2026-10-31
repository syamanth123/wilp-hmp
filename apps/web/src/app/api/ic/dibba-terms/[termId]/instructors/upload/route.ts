import { z } from 'zod';
import { prisma, RoleName } from '@hmp/db';
import { getSessionUser, hasRole } from '@hmp/auth';
import {
  facultyRowsFromRecords,
  importFacultySheet,
  parseCsv,
  parseFacultySheetDetailed,
  type FacultyRow,
} from '@hmp/db/src/dibba-import';
import { rateLimit, tooManyRequests, RATE_LIMITS } from '@/lib/rate-limit';
import {
  DIBBA_MAX_ROWS,
  safeSourceFilename,
  validateFacultySheetUpload,
} from '@/app/ic/dibba/upload-validation';

export const dynamic = 'force-dynamic';

/**
 * IC faculty → course sheet upload (Course Dibba Phase 4, plan §3). A Route
 * Handler for the same reason as the Dibba upload: only a handler owns the
 * body-size ceiling and the error body. Parses the workbook's Sheet3 or a CSV
 * with the same headers, then REPLACES the term's sheet-sourced instructor rows
 * in one transaction (manual rows are kept). Users are never created: the
 * response lists every unmatched email so IC can ask an admin for accounts.
 *
 * Order of checks (cheap before any DB round-trip): origin → session → role →
 * rate limit → multipart → extension/size → termId shape → term exists →
 * parse → row caps → write (audited inside the transaction).
 */
export async function POST(req: Request, { params }: { params: { termId: string } }) {
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

  const me = await getSessionUser();
  if (!me) return Response.json({ error: 'unauthenticated' }, { status: 401 });
  if (!hasRole(me, RoleName.INSTRUCTION_CELL)) {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }

  // Same bucket as the Dibba upload: both are rare IC actions with heavy parsing.
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
    return Response.json(
      { error: 'bad_request', detail: 'Expected multipart form data.' },
      { status: 400 },
    );
  }
  const file = form.get('file');
  if (!(file instanceof File)) {
    return Response.json(
      { error: 'no_file', detail: 'Attach the sheet as "file".' },
      { status: 400 },
    );
  }

  const v = validateFacultySheetUpload({ name: file.name, size: file.size });
  if (!v.ok) {
    const status = v.code === 'unsupported_format' ? 415 : v.code === 'file_too_large' ? 413 : 400;
    return Response.json({ error: v.code, detail: v.message }, { status });
  }

  const termId = z.string().cuid().safeParse(params.termId);
  if (!termId.success) return Response.json({ error: 'invalid_term' }, { status: 400 });
  const term = await prisma.academicTerm.findUnique({
    where: { id: termId.data },
    select: { id: true, name: true },
  });
  if (!term) return Response.json({ error: 'term_not_found' }, { status: 404 });

  const sourceFilename = safeSourceFilename(file.name);
  let rows: FacultyRow[];
  let sourceRowCount: number;
  try {
    if (v.ext === '.csv') {
      const records = parseCsv(Buffer.from(await file.arrayBuffer()).toString('utf8'));
      rows = facultyRowsFromRecords(records);
      sourceRowCount = records.length;
    } else {
      const parsed = await parseFacultySheetDetailed({
        buffer: Buffer.from(await file.arrayBuffer()),
      });
      rows = parsed.rows;
      sourceRowCount = parsed.sheetRowCount;
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message.slice(0, 300) : 'Could not read the file.';
    return Response.json({ error: 'parse_failed', detail }, { status: 422 });
  }

  if (sourceRowCount > DIBBA_MAX_ROWS) {
    return Response.json(
      {
        error: 'too_many_rows',
        detail: `The sheet has ${sourceRowCount} rows; the limit is ${DIBBA_MAX_ROWS}.`,
      },
      { status: 422 },
    );
  }
  // An empty or wrong sheet must not wipe the term's instructor rows.
  if (rows.length === 0) {
    return Response.json(
      {
        error: 'no_rows',
        detail:
          'No row with a course code was found - the sheet needs "Course Number", "FACULTY NAME" and "Email" columns (Sheet3 shape).',
      },
      { status: 422 },
    );
  }

  const result = await importFacultySheet(prisma, {
    termId: term.id,
    rows,
    sourceRowCount,
    actorId: me.id,
  });
  console.info('[dibba-instructors-upload] done', {
    termId: term.id,
    sourceFilename,
    totalRows: result.totalRows,
    matched: result.matched,
    created: result.created,
    unmatched: result.unmatched.length,
  });
  return Response.json({ ok: true, sourceFilename, ...result });
}

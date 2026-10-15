import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DIBBA_UPLOAD_MAX_BYTES } from '@/app/ic/dibba/upload-validation';

// Course Dibba Phase 4 — faculty-sheet upload Route Handler contract (plan §3),
// with no DB: prisma, auth and the limiter are hoisted factory mocks (the
// Phase 3 upload test idiom), the CSV/xlsx parsers run for real, and only
// importFacultySheet (the write) is mocked.

const { prismaMock, getSessionUserMock, hasRoleMock, rateLimitMock, importFacultySheetMock } =
  vi.hoisted(() => ({
    prismaMock: { academicTerm: { findUnique: vi.fn() } },
    getSessionUserMock: vi.fn(),
    hasRoleMock: vi.fn(),
    rateLimitMock: vi.fn(),
    importFacultySheetMock: vi.fn(),
  }));

vi.mock('@hmp/db', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, prisma: prismaMock };
});
vi.mock('@hmp/auth', () => ({ getSessionUser: getSessionUserMock, hasRole: hasRoleMock }));
vi.mock('@/lib/rate-limit', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, rateLimit: rateLimitMock };
});
vi.mock('@hmp/db/src/dibba-import', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, importFacultySheet: importFacultySheetMock };
});

import { POST } from '../route';

const TERM_ID = 'clterm000000000000000000x';
const URL_FOR = (termId: string) =>
  `http://localhost/api/ic/dibba-terms/${termId}/instructors/upload`;

function request(
  fields: Record<string, string | File>,
  termId = TERM_ID,
  headers?: Record<string, string>,
): Request {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return new Request(URL_FOR(termId), {
    method: 'POST',
    body: fd,
    headers: headers ?? { origin: 'http://localhost', host: 'localhost' },
  });
}
const call = (req: Request, termId = TERM_ID) => POST(req, { params: { termId } });
const smallFile = (name: string, bytes: BlobPart = 'x') => new File([bytes], name);

const CSV =
  'FACULTY NAME,Email,Course Number,dabba,PSRN/GFID,Department,Mobile\n' +
  'A Rao (LEAD),A.Rao@Test.Local,CS ZG501,1,P1,CS,9999999999\n' +
  'B Sen,b.sen@test.local,SS ZG527,3,P2,SS,\n' +
  'No Code,nocode@test.local,,2,P3,X,\n';

const RESULT = {
  totalRows: 3,
  matched: 2,
  created: 2,
  alreadyManual: 0,
  noEmail: 0,
  noCourseCode: 1,
  unmatched: [{ email: 'b.sen@test.local', name: 'B Sen', courseCode: 'SS ZG527' }],
};

beforeEach(() => {
  getSessionUserMock.mockReset().mockResolvedValue({ id: 'user1', roles: ['INSTRUCTION_CELL'] });
  hasRoleMock.mockReset().mockReturnValue(true);
  rateLimitMock.mockReset().mockResolvedValue({ ok: true, remaining: 9, retryAfterSec: 0 });
  prismaMock.academicTerm.findUnique.mockReset().mockResolvedValue({ id: TERM_ID, name: 'T' });
  importFacultySheetMock.mockReset().mockResolvedValue(RESULT);
});

async function body(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

describe('POST /api/ic/dibba-terms/[termId]/instructors/upload — guards', () => {
  it('403 bad_origin on a cross-origin or unparseable Origin', async () => {
    expect(
      (await call(request({}, TERM_ID, { origin: 'http://evil.example', host: 'localhost' })))
        .status,
    ).toBe(403);
    expect((await call(request({}, TERM_ID, { origin: 'null', host: 'localhost' }))).status).toBe(
      403,
    );
    expect(getSessionUserMock).not.toHaveBeenCalled();
  });

  it('401 without a session, 403 without the IC role', async () => {
    getSessionUserMock.mockResolvedValue(null);
    expect((await call(request({}))).status).toBe(401);
    getSessionUserMock.mockResolvedValue({ id: 'u', roles: ['FACULTY'] });
    hasRoleMock.mockReturnValue(false);
    expect((await call(request({}))).status).toBe(403);
    expect(hasRoleMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'u' }),
      'INSTRUCTION_CELL',
    );
  });

  it('429 with Retry-After when the shared upload limiter trips', async () => {
    rateLimitMock.mockResolvedValue({ ok: false, remaining: 0, retryAfterSec: 120 });
    const res = await call(request({ file: smallFile('a.csv', CSV) }));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('120');
    expect(rateLimitMock).toHaveBeenCalledWith(
      'dibba-upload:user1',
      expect.any(Number),
      expect.any(Number),
    );
  });

  it('400 no_file, 415 wrong extension, 400 empty, 413 too large — before any DB call', async () => {
    expect((await body(await call(request({})))).error).toBe('no_file');
    expect((await call(request({ file: smallFile('sheet.docx') }))).status).toBe(415);
    expect((await call(request({ file: smallFile('sheet.csv', '') }))).status).toBe(400);
    const big = new File([new ArrayBuffer(DIBBA_UPLOAD_MAX_BYTES + 1)], 'sheet.csv');
    expect((await call(request({ file: big }))).status).toBe(413);
    expect(prismaMock.academicTerm.findUnique).not.toHaveBeenCalled();
  });

  it('400 invalid_term for a non-cuid id, 404 when the term is missing', async () => {
    expect((await call(request({ file: smallFile('a.csv', CSV) }, 'nope'), 'nope')).status).toBe(
      400,
    );
    prismaMock.academicTerm.findUnique.mockResolvedValue(null);
    expect((await call(request({ file: smallFile('a.csv', CSV) }))).status).toBe(404);
    expect(importFacultySheetMock).not.toHaveBeenCalled();
  });
});

describe('POST … — parsing and the write', () => {
  it('422 no_rows for a sheet without any course code (never wipes the term)', async () => {
    const res = await call(
      request({ file: smallFile('a.csv', 'FACULTY NAME,Email,Course Number\nX,x@test.local,\n') }),
    );
    expect(res.status).toBe(422);
    expect((await body(res)).error).toBe('no_rows');
    expect(importFacultySheetMock).not.toHaveBeenCalled();
  });

  it('422 parse_failed for an unreadable workbook', async () => {
    const res = await call(request({ file: smallFile('a.xlsx', 'this is not a workbook') }));
    expect(res.status).toBe(422);
    expect((await body(res)).error).toBe('parse_failed');
    expect(importFacultySheetMock).not.toHaveBeenCalled();
  });

  it('200: parses the CSV through the shared core, passes rows + source count, echoes the result', async () => {
    const res = await call(request({ file: smallFile('faculty 2024.csv', CSV) }));
    expect(res.status).toBe(200);
    expect(importFacultySheetMock).toHaveBeenCalledTimes(1);
    const args = importFacultySheetMock.mock.calls[0]![1] as {
      termId: string;
      rows: Array<{
        courseCode: string;
        email: string | null;
        isLead: boolean;
        facultyName: string;
      }>;
      sourceRowCount: number;
      actorId: string;
    };
    expect(args.termId).toBe(TERM_ID);
    expect(args.actorId).toBe('user1');
    expect(args.sourceRowCount).toBe(3);
    expect(args.rows).toHaveLength(2);
    expect(args.rows[0]).toMatchObject({
      courseCode: 'CS ZG501',
      email: 'a.rao@test.local',
      isLead: true,
      facultyName: 'A Rao',
    });
    expect(args.rows[1]).toMatchObject({ courseCode: 'SS ZG527', isLead: false });
    const json = await body(res);
    expect(json).toMatchObject({ ok: true, sourceFilename: 'faculty 2024.csv', ...RESULT });
  });
});

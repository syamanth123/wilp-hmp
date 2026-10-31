import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SofficeError } from '@hmp/db/src/soffice';
import { DIBBA_UPLOAD_MAX_BYTES } from '@/app/ic/dibba/upload-validation';

// Course Dibba Phase 3 — upload Route Handler contract (plan §3), with no DB
// and no LibreOffice: every collaborator with side effects is a hoisted factory
// mock (the reconciliation.test.ts idiom; `@hmp/db` is spread from the original
// so RoleName stays real). The .docx happy path parses the committed fixture
// for real — only the write is mocked.

const {
  prismaMock,
  getSessionUserMock,
  hasRoleMock,
  rateLimitMock,
  auditMock,
  ensureDocxFormatMock,
  createDibbaImportMock,
} = vi.hoisted(() => ({
  prismaMock: { academicTerm: { findUnique: vi.fn() } },
  getSessionUserMock: vi.fn(),
  hasRoleMock: vi.fn(),
  rateLimitMock: vi.fn(),
  auditMock: vi.fn(),
  ensureDocxFormatMock: vi.fn(),
  createDibbaImportMock: vi.fn(),
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
vi.mock('@/lib/audit', () => ({ audit: auditMock }));
vi.mock('@hmp/db/src/corpus-import', () => ({ ensureDocxFormat: ensureDocxFormatMock }));
vi.mock('@hmp/db/src/dibba-import', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, createDibbaImport: createDibbaImportMock };
});

import { POST } from '@/app/api/ic/dibba-imports/upload/route';

const TERM_ID = 'clterm000000000000000000x';
const FIXTURE = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  '..',
  '..',
  '..',
  'packages',
  'db',
  'src',
  '__fixtures__',
  'dibba',
  'course-dibba-2025-s1.docx',
);

function request(fields: Record<string, string | File>): Request {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return new Request('http://localhost/api/ic/dibba-imports/upload', {
    method: 'POST',
    body: fd,
    headers: { origin: 'http://localhost', host: 'localhost' },
  });
}

const smallFile = (name: string, bytes: BlobPart = 'x') => new File([bytes], name);
/** Node's Buffer is Uint8Array<ArrayBufferLike>; File wants an ArrayBuffer-backed view. */
const fixtureBytes = () => new Uint8Array(readFileSync(FIXTURE));

beforeEach(() => {
  getSessionUserMock.mockReset().mockResolvedValue({ id: 'user1', roles: ['INSTRUCTION_CELL'] });
  hasRoleMock.mockReset().mockReturnValue(true);
  rateLimitMock.mockReset().mockResolvedValue({ ok: true, remaining: 9, retryAfterSec: 0 });
  prismaMock.academicTerm.findUnique.mockReset().mockResolvedValue({ id: TERM_ID });
  auditMock.mockReset().mockResolvedValue(undefined);
  ensureDocxFormatMock.mockReset();
  createDibbaImportMock.mockReset().mockResolvedValue({
    importId: 'imp1',
    rowCount: 1077,
    warningCount: 5,
    unknownCodeCount: 618,
  });
});

async function body(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

describe('POST /api/ic/dibba-imports/upload — guards (no DB reached)', () => {
  it('403 bad_origin on a cross-origin POST', async () => {
    const req = new Request('http://localhost/api/ic/dibba-imports/upload', {
      method: 'POST',
      body: new FormData(),
      headers: { origin: 'http://evil.example', host: 'localhost' },
    });
    expect((await POST(req)).status).toBe(403);
    expect(getSessionUserMock).not.toHaveBeenCalled();
  });

  it.each(['null', 'not a url', ''])(
    '403 bad_origin (not a 500) for an unparseable Origin %j',
    async (origin) => {
      const req = new Request('http://localhost/api/ic/dibba-imports/upload', {
        method: 'POST',
        body: new FormData(),
        headers: { origin, host: 'localhost' },
      });
      const res = await POST(req);
      expect(res.status).toBe(403);
      expect(await body(res)).toEqual({ error: 'bad_origin' });
      expect(getSessionUserMock).not.toHaveBeenCalled();
    },
  );

  it('401 without a session, 403 without the IC role (hasRole, so ADMIN passes)', async () => {
    getSessionUserMock.mockResolvedValue(null);
    expect((await POST(request({}))).status).toBe(401);
    getSessionUserMock.mockResolvedValue({ id: 'u', roles: ['FACULTY'] });
    hasRoleMock.mockReturnValue(false);
    const res = await POST(request({}));
    expect(res.status).toBe(403);
    expect(hasRoleMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'u' }),
      'INSTRUCTION_CELL',
    );
  });

  it('429 with Retry-After when the per-user limiter trips', async () => {
    rateLimitMock.mockResolvedValue({ ok: false, remaining: 0, retryAfterSec: 120 });
    const res = await POST(request({}));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('120');
    expect(rateLimitMock).toHaveBeenCalledWith('dibba-upload:user1', 10, 3600);
  });

  it('400 no_file / invalid_term before any format check', async () => {
    expect(await body(await POST(request({ termId: TERM_ID })))).toEqual({ error: 'no_file' });
    expect(
      await body(await POST(request({ file: smallFile('d.docx'), termId: 'not-a-cuid' }))),
    ).toEqual({ error: 'invalid_term' });
  });

  it('415 / 413 / 400 from the pure validator BEFORE the term lookup', async () => {
    const r415 = await POST(request({ file: smallFile('d.csv'), termId: TERM_ID }));
    expect(r415.status).toBe(415);
    expect((await body(r415)).error).toBe('unsupported_format');
    const r413 = await POST(
      request({
        file: smallFile('d.docx', new ArrayBuffer(DIBBA_UPLOAD_MAX_BYTES + 1)),
        termId: TERM_ID,
      }),
    );
    expect(r413.status).toBe(413);
    const r400 = await POST(request({ file: new File([], 'd.docx'), termId: TERM_ID }));
    expect(r400.status).toBe(400);
    expect((await body(r400)).error).toBe('empty_file');
    expect(prismaMock.academicTerm.findUnique).not.toHaveBeenCalled();
  });

  it('404 term_not_found', async () => {
    prismaMock.academicTerm.findUnique.mockResolvedValue(null);
    const res = await POST(request({ file: smallFile('d.docx'), termId: TERM_ID }));
    expect(res.status).toBe(404);
    expect(createDibbaImportMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/ic/dibba-imports/upload — conversion and parse outcomes', () => {
  it('503 converter_unavailable when LibreOffice is missing (.doc); nothing written', async () => {
    ensureDocxFormatMock.mockRejectedValue(new SofficeError('no soffice', 'missing-binary'));
    const res = await POST(request({ file: smallFile('legacy.doc'), termId: TERM_ID }));
    expect(res.status).toBe(503);
    expect((await body(res)).error).toBe('converter_unavailable');
    expect(createDibbaImportMock).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('504 conversion_timeout and 422 conversion_failed for the other SofficeError kinds', async () => {
    ensureDocxFormatMock.mockRejectedValue(new SofficeError('slow', 'timeout'));
    expect((await POST(request({ file: smallFile('legacy.doc'), termId: TERM_ID }))).status).toBe(
      504,
    );
    ensureDocxFormatMock.mockRejectedValue(new SofficeError('bad', 'conversion-failed'));
    expect((await POST(request({ file: smallFile('legacy.doc'), termId: TERM_ID }))).status).toBe(
      422,
    );
  });

  it('422 parse_failed with a generic detail for a corrupt .docx', async () => {
    const res = await POST(
      request({ file: smallFile('broken.docx', 'not a zip'), termId: TERM_ID }),
    );
    expect(res.status).toBe(422);
    expect(await body(res)).toEqual({ error: 'parse_failed', detail: 'Not a valid .docx file.' });
    expect(createDibbaImportMock).not.toHaveBeenCalled();
  });

  it('200 for the committed 2025 .docx: parses for real, writes once, audits, returns counts', async () => {
    const res = await POST(
      request({ file: new File([fixtureBytes()], 'course-dibba-2025-s1.docx'), termId: TERM_ID }),
    );
    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({
      ok: true,
      importId: 'imp1',
      rowCount: 1077,
      warningCount: 5,
      unknownCodeCount: 618,
      tableCount: 51,
      sheetRowCount: null,
    });
    expect(createDibbaImportMock).toHaveBeenCalledTimes(1);
    const args = createDibbaImportMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(args).toMatchObject({
      termId: TERM_ID,
      label: 'course-dibba-2025-s1', // no date in the name → basename
      sourceFilename: 'course-dibba-2025-s1.docx',
      sourceFormat: 'docx',
      uploadedById: 'user1',
    });
    expect((args.rows as unknown[]).length).toBe(1077);
    expect((args.warnings as string[]).length).toBe(5);
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user1',
        action: 'dibba.import.upload',
        entity: 'DibbaImport',
        entityId: 'imp1',
        after: expect.objectContaining({ rowCount: 1077, tableCount: 51 }),
      }),
    );
  }, 30_000);

  it('an explicit label wins and is trimmed/capped; an audit failure does not fail the upload', async () => {
    auditMock.mockRejectedValue(new Error('audit down'));
    const res = await POST(
      request({
        file: new File([fixtureBytes()], 'dibba as on 02.07.2025.docx'),
        termId: TERM_ID,
        label: `  ${'L'.repeat(200)}  `,
      }),
    );
    expect(res.status).toBe(200);
    const args = createDibbaImportMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(args.label).toBe('L'.repeat(120));
  }, 30_000);
});

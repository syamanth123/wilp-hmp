import { describe, it, expect } from 'vitest';
import {
  DIBBA_ACCEPT_ATTR,
  DIBBA_UPLOAD_MAX_BYTES,
  deriveDibbaLabel,
  extensionOf,
  safeSourceFilename,
  validateDibbaUpload,
} from './upload-validation';

describe('validateDibbaUpload', () => {
  it('accepts .doc / .docx / .xlsx by extension, case-insensitively, and returns the validated ext', () => {
    expect(validateDibbaUpload({ name: 'dibba.doc', size: 1 })).toEqual({ ok: true, ext: '.doc' });
    expect(validateDibbaUpload({ name: 'DIBBA.DOCX', size: 1 })).toEqual({
      ok: true,
      ext: '.docx',
    });
    expect(validateDibbaUpload({ name: 'C:\\Users\\x\\Course Dibba.XLSX', size: 1 })).toEqual({
      ok: true,
      ext: '.xlsx',
    });
  });

  it('rejects other extensions as unsupported_format regardless of size', () => {
    for (const name of ['dibba.csv', 'dibba.pdf', 'dibba', '.docx', 'dibba.docx.exe']) {
      expect(validateDibbaUpload({ name, size: 10 })).toMatchObject({
        ok: false,
        code: 'unsupported_format',
      });
    }
  });

  it('empty_file before file_too_large; the limit itself is allowed, one byte more is not', () => {
    expect(validateDibbaUpload({ name: 'a.docx', size: 0 })).toMatchObject({ code: 'empty_file' });
    expect(validateDibbaUpload({ name: 'a.docx', size: DIBBA_UPLOAD_MAX_BYTES })).toEqual({
      ok: true,
      ext: '.docx',
    });
    expect(validateDibbaUpload({ name: 'a.docx', size: DIBBA_UPLOAD_MAX_BYTES + 1 })).toMatchObject(
      {
        code: 'file_too_large',
      },
    );
  });

  it('safeSourceFilename strips paths and control characters (log-line forging) and caps at 255', () => {
    const nul = String.fromCharCode(0);
    expect(safeSourceFilename('C:\\x\\a\nb.docx')).toBe('a b.docx');
    expect(safeSourceFilename(`a${nul}b\r\n[dibba-upload] forged.docx`)).toBe(
      'a b  [dibba-upload] forged.docx',
    );
    expect(safeSourceFilename(`${'x'.repeat(300)}.docx`)).toHaveLength(255);
  });

  it('the accept attribute lists exactly the allowed extensions', () => {
    expect(DIBBA_ACCEPT_ATTR).toBe('.doc,.docx,.xlsx');
    expect(extensionOf('x.tar.gz')).toBe('.gz');
    expect(extensionOf('noext')).toBe('');
  });
});

describe('deriveDibbaLabel', () => {
  const now = new Date('2026-10-01T10:00:00Z');

  it('uses the first dd.mm.yyyy / dd-mm-yyyy in the basename', () => {
    expect(deriveDibbaLabel('Course Dibba S1 2025-26 as on 02.07.2025.doc', now)).toBe(
      'As on 02.07.2025',
    );
    expect(deriveDibbaLabel('/tmp/dibba 15-08-2025 final.xlsx', now)).toBe('As on 15.08.2025');
  });

  it('falls back to the basename without extension, then to the upload date', () => {
    expect(deriveDibbaLabel('course-dibba-2025-s1.docx', now)).toBe('course-dibba-2025-s1');
    expect(deriveDibbaLabel('.docx', now)).toBe('Dibba upload 2026-10-01');
    expect(deriveDibbaLabel('', now)).toBe('Dibba upload 2026-10-01');
  });

  it('never exceeds 120 characters', () => {
    expect(deriveDibbaLabel(`${'x'.repeat(300)}.docx`, now)).toHaveLength(120);
  });
});

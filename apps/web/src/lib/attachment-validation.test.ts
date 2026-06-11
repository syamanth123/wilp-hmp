import { describe, it, expect } from 'vitest';
import {
  validateAttachment,
  MAX_SIZE_BYTES,
  MAX_SIZE_MB,
  ALLOWED_MIME_LIST,
} from './attachment-validation';

describe('validateAttachment', () => {
  it('accepts each allowed MIME type at a normal size', () => {
    for (const mimeType of ALLOWED_MIME_LIST) {
      expect(validateAttachment({ mimeType, size: 1024 })).toEqual({ ok: true });
    }
  });

  it('rejects an empty file', () => {
    const r = validateAttachment({ mimeType: 'application/pdf', size: 0 });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('empty_file');
  });

  it('rejects a file over the size limit', () => {
    const r = validateAttachment({ mimeType: 'application/pdf', size: MAX_SIZE_BYTES + 1 });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('file_too_large');
    expect(r.message).toContain(`${MAX_SIZE_MB} MB`);
  });

  it('accepts a file exactly at the size limit', () => {
    expect(validateAttachment({ mimeType: 'application/pdf', size: MAX_SIZE_BYTES })).toEqual({
      ok: true,
    });
  });

  it('rejects a disallowed MIME type (e.g. a zip or executable)', () => {
    for (const mimeType of ['application/zip', 'application/x-msdownload', 'text/html', '']) {
      const r = validateAttachment({ mimeType, size: 1024 });
      expect(r.ok).toBe(false);
      expect(r.code).toBe('invalid_file_type');
    }
  });

  it('checks size before type (empty + bad type → empty_file)', () => {
    const r = validateAttachment({ mimeType: 'application/zip', size: 0 });
    expect(r.code).toBe('empty_file');
  });
});

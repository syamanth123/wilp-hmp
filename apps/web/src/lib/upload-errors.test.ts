import { describe, expect, it } from 'vitest';
import { uploadFailureMessage } from './upload-errors';

describe('uploadFailureMessage', () => {
  it('turns codes into sentences', () => {
    expect(uploadFailureMessage('invalid_term')).toBe('Pick a term first, then upload.');
  });
  it('never shows a raw code or an HTTP status', () => {
    for (const code of [undefined, 'http_500', 'weird_code']) {
      const msg = uploadFailureMessage(code);
      expect(msg).not.toMatch(/http_|_code|undefined/);
    }
  });
  it('keeps a readable detail and drops a coded one', () => {
    expect(uploadFailureMessage('no_rows', 'Sheet "MTech SE" is empty')).toContain(
      '(Sheet "MTech SE" is empty)',
    );
    expect(uploadFailureMessage('no_rows', 'sheet_missing')).toBe('The file has no course rows.');
  });
});

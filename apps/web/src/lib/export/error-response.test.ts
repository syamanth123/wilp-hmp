import { describe, expect, it } from 'vitest';
import { exportErrorResponse } from './error-response';

const browser = new Request('http://x/api', { headers: { accept: 'text/html,*/*' } });
const script = new Request('http://x/api', { headers: { accept: 'application/json' } });

describe('exportErrorResponse', () => {
  it('gives a browser a plain-words page with the same status', async () => {
    const res = exportErrorResponse(browser, 503, 'pdf_unavailable', { kind: 'missing-binary' });
    expect(res.status).toBe(503);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('The PDF isn’t available right now');
    expect(html).toContain('Download the Word file instead');
    expect(html).not.toContain('pdf_unavailable');
    expect(html).not.toContain('missing-binary');
  });

  it('keeps the JSON error code for scripts', async () => {
    const res = exportErrorResponse(script, 403, 'forbidden');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
  });
});

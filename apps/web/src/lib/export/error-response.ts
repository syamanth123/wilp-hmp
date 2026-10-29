/**
 * Download errors in plain words. The Word/PDF download is a plain link, so a
 * failure used to open a page of raw JSON such as {"error":"pdf_unavailable"}.
 * Browsers (which ask for HTML) now get a short page saying what happened and
 * what to do next; scripts and tests still get the JSON error code. The HTTP
 * status is unchanged either way.
 */

export type ExportErrorCode =
  | 'bad_format'
  | 'unauthenticated'
  | 'request_not_found'
  | 'forbidden'
  | 'no_structured_handout'
  | 'unparseable_handout'
  | 'pdf_unavailable';

const MESSAGES: Record<ExportErrorCode, { title: string; body: string }> = {
  bad_format: {
    title: 'That download type isn’t available',
    body: 'Handouts can be downloaded as Word or PDF. Use the Download menu on the handout page.',
  },
  unauthenticated: {
    title: 'Please sign in',
    body: 'Your session has ended. Sign in again, then download the handout.',
  },
  request_not_found: {
    title: 'Handout not found',
    body: 'This handout no longer exists or the link is wrong. Go back and open it from your list.',
  },
  forbidden: {
    title: 'You can’t download this handout',
    body: 'Downloads are available to the handout’s faculty member once it is submitted, and to the Instruction Cell and Head of Group once it is approved.',
  },
  no_structured_handout: {
    title: 'Nothing to download yet',
    body: 'This handout has no saved content in the new editor. Open it, save a draft, then try again.',
  },
  unparseable_handout: {
    title: 'This handout can’t be downloaded',
    body: 'Its saved content is incomplete. Open the handout, check every section, save it, then try again.',
  },
  pdf_unavailable: {
    title: 'The PDF isn’t available right now',
    body: 'The PDF converter didn’t respond. Download the Word file instead, or try the PDF again in a few minutes.',
  },
};

export function exportErrorMessage(code: ExportErrorCode): { title: string; body: string } {
  return MESSAGES[code];
}

export function wantsHtml(req: Request): boolean {
  return (req.headers.get('accept') ?? '').includes('text/html');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}

export function exportErrorResponse(
  req: Request,
  status: number,
  code: ExportErrorCode,
  extra: Record<string, unknown> = {},
): Response {
  if (!wantsHtml(req)) return Response.json({ error: code, ...extra }, { status });
  const { title, body } = MESSAGES[code];
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>body{font-family:Arial,Helvetica,sans-serif;background:#f4f6fb;color:#1f2a44;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px}
main{background:#fff;border:1px solid #d8e0f4;border-radius:10px;max-width:460px;padding:32px;text-align:center}
h1{font-size:20px;margin:0 0 8px}p{color:#5b6782;line-height:1.5}a{color:#1f3c88}</style></head>
<body><main data-testid="export-error"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p>
<p>Use your browser's Back button, or <a href="/">go to your home page</a>.</p></main></body></html>`;
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

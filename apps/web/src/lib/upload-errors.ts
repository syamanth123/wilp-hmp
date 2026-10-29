/**
 * Course Dibba and faculty-sheet upload failures in plain words. The upload
 * routes answer with short codes; nobody should see "invalid_term" or
 * "http_500". A detail line from the server is kept only when it reads like a
 * sentence (e.g. which sheet or row was wrong).
 */
const MESSAGES: Record<string, string> = {
  rate_limited: 'Too many uploads in the last hour. Try again later.',
  invalid_term: 'Pick a term first, then upload.',
  term_not_found: 'That term no longer exists. Refresh the page and pick a term.',
  no_file: 'Choose the Excel file first, then upload.',
  invalid_multipart: 'Choose the Excel file first, then upload.',
  bad_request: 'Something was missing from the upload. Refresh the page and try again.',
  bad_origin: 'The upload was blocked. Refresh the page and try again.',
  unauthenticated: 'Your session has ended. Sign in again, then upload.',
  forbidden: "You don't have permission to upload this.",
  parse_failed: "We couldn't read this file. Check it is the Course Dibba workbook.",
  no_rows: 'The file has no course rows.',
  too_many_rows: 'The file has more rows than we can read in one upload.',
  converter_unavailable:
    "The file converter isn't available right now. Try again in a few minutes.",
  conversion_failed: "We couldn't open this file. Save it again in Excel and upload the new copy.",
  conversion_timeout: 'Opening the file took too long. Try again in a few minutes.',
  processing_failed: 'Something went wrong reading the file. Please try again.',
  bad_response: 'The server sent an unexpected reply. Please try again.',
};

export function uploadFailureMessage(code: string | undefined, detail?: string): string {
  const base = (code && MESSAGES[code]) || 'Something went wrong. Please try again.';
  const readableDetail = detail && /\s/.test(detail) && !/^[a-z_]+$/.test(detail) ? detail : null;
  return readableDetail ? `${base} (${readableDetail})` : base;
}

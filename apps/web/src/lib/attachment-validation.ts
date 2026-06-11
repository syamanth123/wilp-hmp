// Shared attachment validation (Prompt 16). Plain TypeScript — NO 'use server' —
// so it's importable from both the client upload form (immediate UX feedback)
// and the server-side Route Handler (authoritative security check). The client
// check is a courtesy; the server check is the one that matters.

export const MAX_SIZE_MB = 50;
export const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;

/** Allowed upload MIME types → a human label (used in the UI hint). */
export const ALLOWED_MIME_TYPES: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word (.docx)',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel (.xlsx)',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PowerPoint (.pptx)',
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
};

export const ALLOWED_MIME_LIST = Object.keys(ALLOWED_MIME_TYPES);
export const ALLOWED_ACCEPT_ATTR = '.pdf,.docx,.xlsx,.pptx,.png,.jpg,.jpeg';

export type AttachmentValidationCode = 'invalid_file_type' | 'file_too_large' | 'empty_file';

export interface AttachmentValidationResult {
  ok: boolean;
  code?: AttachmentValidationCode;
  message?: string;
}

/** Validates a candidate upload by MIME type + size. Used client- and server-side. */
export function validateAttachment(input: {
  mimeType: string;
  size: number;
}): AttachmentValidationResult {
  if (input.size <= 0) {
    return { ok: false, code: 'empty_file', message: 'File is empty.' };
  }
  if (input.size > MAX_SIZE_BYTES) {
    return {
      ok: false,
      code: 'file_too_large',
      message: `File exceeds the ${MAX_SIZE_MB} MB limit.`,
    };
  }
  if (!ALLOWED_MIME_LIST.includes(input.mimeType)) {
    return {
      ok: false,
      code: 'invalid_file_type',
      message: `Unsupported file type. Allowed: ${Object.values(ALLOWED_MIME_TYPES).join(', ')}.`,
    };
  }
  return { ok: true };
}

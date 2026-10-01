// Course Dibba upload validation (Phase 3, plan D1). Plain TypeScript — NO
// 'use server' and no server-only imports — so the IC upload form (immediate
// feedback, `accept` attribute) and the Route Handler (the authoritative check)
// share ONE set of rules, the same split as lib/attachment-validation.ts.
//
// Validation is by EXTENSION, never by `file.type`: browsers send vendor or
// empty MIME types for legacy Office files (and Windows reports CSV as
// application/vnd.ms-excel), and the spec's attachment allow-list has no
// `application/msword` at all. The Route Handler then writes the temp file as
// `<uuid><ext>` with THIS validated extension, never `file.name`.

export const ALLOWED_EXT = ['.doc', '.docx', '.xlsx'] as const;
export type DibbaUploadExt = (typeof ALLOWED_EXT)[number];

/** 8 MB — same number as CORPUS_IMPORT_MAX_BYTES and deliberately below nginx's
 * `client_max_body_size 10m`, so an oversize file gets OUR 413 JSON, not the
 * proxy's HTML page. The real files are 601 KB (.doc) / 298 KB (.xlsx) / 70 KB (.docx). */
export const DIBBA_UPLOAD_MAX_MB = 8;
export const DIBBA_UPLOAD_MAX_BYTES = DIBBA_UPLOAD_MAX_MB * 1024 * 1024;

/** Parsed-row ceiling checked after parsing and before any DB write (~5x the real 1,077). */
export const DIBBA_MAX_ROWS = 5_000;

export const DIBBA_ACCEPT_ATTR = ALLOWED_EXT.join(',');

export type DibbaUploadValidationCode = 'unsupported_format' | 'file_too_large' | 'empty_file';

export type DibbaUploadValidation =
  | { ok: true; ext: DibbaUploadExt }
  | { ok: false; code: DibbaUploadValidationCode; message: string };

/** Lower-cased extension including the dot, from the LAST dot of the basename ('' when none). */
export function extensionOf(name: string): string {
  const base = basenameOf(name);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot).toLowerCase();
}

/** Basename for a browser-supplied name (split on both separators; never trust a path). */
export function basenameOf(name: string): string {
  return name.split(/[\\/]/).pop() ?? '';
}

/**
 * What gets stored as `DibbaImport.sourceFilename`, audited and logged: the
 * basename with control characters (CR/LF included — a crafted multipart
 * filename could otherwise forge a log line) replaced by spaces, capped at 255.
 */
export function safeSourceFilename(name: string): string {
  return basenameOf(name)
    .replace(/\p{Cc}/gu, ' ')
    .trim()
    .slice(0, 255);
}

export function validateDibbaUpload(input: { name: string; size: number }): DibbaUploadValidation {
  const ext = extensionOf(input.name);
  if (!(ALLOWED_EXT as readonly string[]).includes(ext)) {
    return {
      ok: false,
      code: 'unsupported_format',
      message: 'Only .doc, .docx or .xlsx files can be uploaded.',
    };
  }
  if (input.size <= 0) {
    return { ok: false, code: 'empty_file', message: 'File is empty.' };
  }
  if (input.size > DIBBA_UPLOAD_MAX_BYTES) {
    return {
      ok: false,
      code: 'file_too_large',
      message: `File exceeds the ${DIBBA_UPLOAD_MAX_MB} MB limit.`,
    };
  }
  return { ok: true, ext: ext as DibbaUploadExt };
}

const DATE_IN_NAME = /(\d{2})[.-](\d{2})[.-](\d{4})/;

/**
 * Default import label (spec §4: "As on 02.07.2025"). The real filenames carry
 * the date ("Course Dibba S1 2025-26 as on 02.07.2025.doc"); otherwise the
 * basename without its extension; a nameless upload gets the upload date.
 * Always ≤ 120 characters. The server applies this when the form sends no label.
 */
export function deriveDibbaLabel(filename: string, now: Date = new Date()): string {
  const base = basenameOf(filename);
  const m = DATE_IN_NAME.exec(base);
  if (m) return `As on ${m[1]}.${m[2]}.${m[3]}`;
  // Strip one trailing ".ext" token wherever it sits (so ".docx" alone → "").
  const stem = base.replace(/\.[A-Za-z0-9]+$/, '').trim();
  const label = stem || `Dibba upload ${now.toISOString().slice(0, 10)}`;
  return label.slice(0, 120);
}

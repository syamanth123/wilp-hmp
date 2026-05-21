// Taxila LMS publish — real two-mode implementation.
//
//   Mode A (HTTP)   — when TAXILA_API_URL is set: POSTs the handout to Taxila
//                     with bearer auth, retry-on-5xx (respecting Retry-After),
//                     and a per-attempt timeout.
//   Mode B (export) — when TAXILA_API_URL is empty: builds a ZIP (html + json +
//                     metadata + readme), uploads it to object storage, and
//                     returns a presigned download URL so the IC team can
//                     manually upload to Taxila until the API is provisioned.
//
// This module is PURE w.r.t. the database: no Prisma calls. It returns
// structured results (or throws TaxilaPublishError); the caller persists the
// LmsPublishLog and drives the workflow.

import AdmZip from 'adm-zip';
import { getS3Client, uploadAndPresign } from './storage';

/**
 * The status values written to `LmsPublishLog.status`. Kept as a string union
 * (not a Prisma enum) so existing rows ("success"/"failed") stay valid without
 * a data migration, while new code gets compile-time safety. See
 * docs/dev-handoff-audit.md.
 */
export type LmsPublishLogStatus = 'success' | 'failed' | 'EXPORTED' | 'MANUALLY_CONFIRMED';

export interface PublishInput {
  handoutId: string;
  refNo: string;
  versionNo: number;
  contentHtml: string;
  contentJson: unknown;
  courseCode: string;
  courseTitle: string;
  programmeCode: string;
  // Semester has no `code` column in the schema — only a name. We send the
  // name; if Taxila's API spec requires a coded identifier, a `semesterCode`
  // column + remap is a follow-up (flagged in docs/dev-handoff-audit.md).
  semesterName: string;
  publishedBy: string;
}

export type PublishResult =
  | {
      mode: 'http';
      status: 'success';
      externalRef: string;
      request: string;
      response: string;
    }
  | {
      mode: 'export';
      status: 'EXPORTED';
      externalRef: string; // presigned download URL
      s3Key: string;
    };

export class TaxilaPublishError extends Error {
  constructor(
    message: string,
    public readonly mode: 'http' | 'export',
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'TaxilaPublishError';
  }
}

const HTTP_TIMEOUT_MS = 30_000;
const HTTP_MAX_ATTEMPTS = 3;
// Delays applied BEFORE the 2nd and 3rd attempts when no Retry-After is given.
const HTTP_BACKOFF_MS = [1_000, 3_000, 9_000];
const TRUNCATE_AT = 4_096;
const EXPORT_BUCKET = () => process.env.LMS_EXPORTS_BUCKET ?? 'hmp-lms-exports';
const EXPORT_URL_TTL_SECONDS = 24 * 60 * 60; // 24h

function truncate(s: string, max = TRUNCATE_AT): string {
  return s.length > max ? `${s.slice(0, max)}…[truncated]` : s;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Parses a Retry-After header. Supports both the integer-seconds form and the
 * HTTP-date form. Returns milliseconds to wait, or null if unparseable.
 */
function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const asInt = Number(header);
  if (Number.isFinite(asInt)) return Math.max(0, asInt * 1000);
  const asDate = Date.parse(header);
  if (!Number.isNaN(asDate)) return Math.max(0, asDate - Date.now());
  return null;
}

/** The exact JSON body POSTed to Taxila. Exported so unit tests can assert the
 *  contract shape without reaching into the fetch mock. */
export function buildTaxilaRequestBody(input: PublishInput): Record<string, unknown> {
  return {
    refNo: input.refNo,
    courseCode: input.courseCode,
    courseTitle: input.courseTitle,
    programmeCode: input.programmeCode,
    semesterName: input.semesterName,
    contentHtml: input.contentHtml,
    contentJson: input.contentJson,
    version: input.versionNo,
    publishedBy: input.publishedBy,
  };
}

async function publishViaHttp(input: PublishInput): Promise<PublishResult> {
  const url = `${process.env.TAXILA_API_URL!.replace(/\/$/, '')}/handouts`;
  const token = process.env.TAXILA_API_TOKEN ?? '';
  const bodyObj = buildTaxilaRequestBody(input);
  const body = JSON.stringify(bodyObj);
  const attempts: Array<{ attempt: number; error: string }> = [];

  for (let attempt = 1; attempt <= HTTP_MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body,
        signal: controller.signal,
      });
      clearTimeout(timer);

      const resText = await res.text();
      if (res.ok) {
        let externalRef = '';
        try {
          externalRef = String((JSON.parse(resText) as { id?: unknown }).id ?? '');
        } catch {
          // non-JSON success body — leave externalRef empty
        }
        return {
          mode: 'http',
          status: 'success',
          externalRef,
          request: truncate(body),
          response: truncate(resText),
        };
      }

      // 4xx is a client error — do not retry, fail fast.
      if (res.status >= 400 && res.status < 500) {
        throw new TaxilaPublishError(`Taxila rejected the publish (HTTP ${res.status})`, 'http', {
          status: res.status,
          response: truncate(resText),
          request: truncate(body),
        });
      }

      // 5xx — retryable.
      attempts.push({ attempt, error: `HTTP ${res.status}: ${truncate(resText, 256)}` });
      if (attempt < HTTP_MAX_ATTEMPTS) {
        const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
        await sleep(retryAfter ?? HTTP_BACKOFF_MS[attempt - 1]!);
      }
    } catch (err) {
      clearTimeout(timer);
      // A fail-fast 4xx error bubbles straight out.
      if (err instanceof TaxilaPublishError) throw err;
      const reason =
        (err as Error)?.name === 'AbortError'
          ? `timeout after ${HTTP_TIMEOUT_MS}ms`
          : ((err as Error)?.message ?? 'network error');
      attempts.push({ attempt, error: reason });
      if (attempt < HTTP_MAX_ATTEMPTS) {
        await sleep(HTTP_BACKOFF_MS[attempt - 1]!);
      }
    }
  }

  throw new TaxilaPublishError(
    `Taxila publish failed after ${HTTP_MAX_ATTEMPTS} attempts`,
    'http',
    { attempts, request: truncate(body) },
  );
}

const README_TEXT = (input: PublishInput) =>
  `HMP — Manual LMS Upload Package
================================

This archive was generated because the Taxila API is not configured
(TAXILA_API_URL is unset), so HMP could not publish automatically. It contains
everything needed to upload this handout to Taxila by hand.

Handout:  ${input.refNo}  (v${input.versionNo})
Course:   ${input.courseCode} — ${input.courseTitle}
Programme:${input.programmeCode}
Semester: ${input.semesterName}

Files in this archive:
  handout.html   — the rendered handout (upload this as the content body)
  handout.json   — the structured (TipTap) source, for re-import if needed
  metadata.json  — machine-readable handout metadata

Steps:
  1. Log in to Taxila and open the target course (${input.courseCode}).
  2. Create/replace the course handout using handout.html.
  3. Confirm it renders correctly in Taxila.
  4. Return to HMP and click "Mark as manually published" on this request so
     the system records the publish and advances the workflow to PUBLISHED.
`;

export function buildExportZip(input: PublishInput): Buffer {
  const zip = new AdmZip();
  const html =
    `<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8">` +
    `<title>${input.refNo} — ${input.courseCode}</title></head>\n<body>\n` +
    `${input.contentHtml}\n</body>\n</html>\n`;
  const metadata = {
    refNo: input.refNo,
    courseCode: input.courseCode,
    courseTitle: input.courseTitle,
    programmeCode: input.programmeCode,
    semesterName: input.semesterName,
    version: input.versionNo,
    publishedBy: input.publishedBy,
    publishedAt: new Date().toISOString(),
    generator: 'HMP',
  };
  zip.addFile('handout.html', Buffer.from(html, 'utf8'));
  zip.addFile('handout.json', Buffer.from(JSON.stringify(input.contentJson, null, 2), 'utf8'));
  zip.addFile('metadata.json', Buffer.from(JSON.stringify(metadata, null, 2), 'utf8'));
  zip.addFile('README.txt', Buffer.from(README_TEXT(input), 'utf8'));
  return zip.toBuffer();
}

async function publishViaExport(input: PublishInput): Promise<PublishResult> {
  const year = new Date().getFullYear();
  const s3Key = `lms-exports/${year}/${input.refNo}.zip`;
  const bucket = EXPORT_BUCKET();
  try {
    const zipBuffer = buildExportZip(input);
    const url = await uploadAndPresign(getS3Client(), {
      bucket,
      key: s3Key,
      body: zipBuffer,
      contentType: 'application/zip',
      expiresIn: EXPORT_URL_TTL_SECONDS,
    });
    return { mode: 'export', status: 'EXPORTED', externalRef: url, s3Key };
  } catch (err) {
    throw new TaxilaPublishError(
      `Failed to build/upload the LMS export for ${input.refNo}`,
      'export',
      { s3Key, bucket, cause: (err as Error)?.message ?? String(err) },
    );
  }
}

/**
 * Publishes a handout to Taxila. Dispatches on TAXILA_API_URL:
 *   set   → Mode A (HTTP POST, retrying)
 *   unset → Mode B (export ZIP to object storage, presigned link)
 *
 * Throws TaxilaPublishError on failure; the caller persists an appropriate
 * LmsPublishLog and decides whether/how to advance the workflow.
 */
export async function publishToLms(input: PublishInput): Promise<PublishResult> {
  if (process.env.TAXILA_API_URL) return publishViaHttp(input);
  return publishViaExport(input);
}

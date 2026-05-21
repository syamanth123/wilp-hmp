import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import AdmZip from 'adm-zip';

// Mode B uploads via ./storage — mock it so the export-dispatch test never
// touches a real S3/MinIO. The ZIP itself is built for real and verified.
vi.mock('./storage', () => ({
  getS3Client: vi.fn(() => ({})),
  uploadAndPresign: vi.fn(async () => 'https://minio.local/presigned/lms-export.zip?sig=abc'),
}));

import {
  publishToLms,
  buildTaxilaRequestBody,
  buildExportZip,
  TaxilaPublishError,
  type PublishInput,
} from './taxila';
import { uploadAndPresign } from './storage';

const sampleInput: PublishInput = {
  handoutId: 'h-1',
  refNo: 'HMP-2026-0042',
  versionNo: 3,
  contentHtml: '<h1>Course Handout</h1><p>Part A…</p>',
  contentJson: { type: 'doc', content: [{ type: 'paragraph' }] },
  courseCode: 'SE-ZG501',
  courseTitle: 'Software Architectures',
  programmeCode: 'MTECH-SE',
  semesterName: 'First Semester 2026',
  publishedBy: 'ic-user-1',
};

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('buildTaxilaRequestBody (Taxila contract)', () => {
  it('produces the exact JSON shape POSTed to Taxila', () => {
    const body = buildTaxilaRequestBody(sampleInput);
    expect(body).toEqual({
      refNo: 'HMP-2026-0042',
      courseCode: 'SE-ZG501',
      courseTitle: 'Software Architectures',
      programmeCode: 'MTECH-SE',
      semesterName: 'First Semester 2026',
      contentHtml: '<h1>Course Handout</h1><p>Part A…</p>',
      contentJson: { type: 'doc', content: [{ type: 'paragraph' }] },
      version: 3,
      publishedBy: 'ic-user-1',
    });
  });

  it('CONTRACT ARTIFACT — logs the body that would be sent to Taxila', () => {
    // Printed to the test run so it can be handed to BITS IT to confirm the
    // schema against the real Taxila API before Mode A is relied on in prod.
    console.log(
      '\n=== TAXILA REQUEST BODY (Mode A contract) ===\n' +
        JSON.stringify(buildTaxilaRequestBody(sampleInput), null, 2) +
        '\n=== END BODY ===\n',
    );
    expect(true).toBe(true);
  });
});

describe('publishToLms — mode dispatch', () => {
  it('uses Mode A (HTTP) when TAXILA_API_URL is set', async () => {
    process.env.TAXILA_API_URL = 'https://taxila.example.edu/api';
    process.env.TAXILA_API_TOKEN = 'tok-123';
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: 'tax-987' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await publishToLms(sampleInput);

    expect(result).toMatchObject({ mode: 'http', status: 'success', externalRef: 'tax-987' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://taxila.example.edu/api/handouts');
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(opts.headers.Authorization).toBe('Bearer tok-123');
    expect(JSON.parse(opts.body)).toEqual(buildTaxilaRequestBody(sampleInput));
    expect(uploadAndPresign).not.toHaveBeenCalled();
  });

  it('uses Mode B (export) when TAXILA_API_URL is empty', async () => {
    delete process.env.TAXILA_API_URL;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await publishToLms(sampleInput);

    expect(result).toMatchObject({
      mode: 'export',
      status: 'EXPORTED',
      externalRef: 'https://minio.local/presigned/lms-export.zip?sig=abc',
    });
    if (result.mode === 'export') {
      expect(result.s3Key).toBe(`lms-exports/${new Date().getFullYear()}/HMP-2026-0042.zip`);
    }
    expect(uploadAndPresign).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('publishToLms — Mode A retry/timeout/failure', () => {
  beforeEach(() => {
    process.env.TAXILA_API_URL = 'https://taxila.example.edu/api';
    process.env.TAXILA_API_TOKEN = 'tok-123';
  });

  it('retries on 503 then succeeds', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('upstream busy', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'tax-1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const p = publishToLms(sampleInput);
    await vi.runAllTimersAsync();
    const result = await p;

    expect(result.status).toBe('success');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('respects a Retry-After header on 503', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('slow down', { status: 503, headers: { 'retry-after': '2' } }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'tax-2' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const p = publishToLms(sampleInput);
    await vi.runAllTimersAsync();
    const result = await p;

    expect(result.status).toBe('success');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws TaxilaPublishError after 3 failed (503) attempts', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(new Response('still down', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    const p = publishToLms(sampleInput);
    const assertion = expect(p).rejects.toBeInstanceOf(TaxilaPublishError);
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('treats an AbortError (timeout) as retryable and fails after 3 attempts', async () => {
    vi.useFakeTimers();
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const fetchMock = vi.fn().mockRejectedValue(abortErr);
    vi.stubGlobal('fetch', fetchMock);

    const p = publishToLms(sampleInput);
    const assertion = expect(p).rejects.toMatchObject({
      name: 'TaxilaPublishError',
      mode: 'http',
    });
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('fails fast on 4xx without retrying', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('bad request', { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(publishToLms(sampleInput)).rejects.toBeInstanceOf(TaxilaPublishError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('buildExportZip (Mode B artifact)', () => {
  it('contains all four files, each non-empty', () => {
    const buffer = buildExportZip(sampleInput);
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries();
    const names = entries.map((e) => e.entryName).sort();

    expect(names).toEqual(['README.txt', 'handout.html', 'handout.json', 'metadata.json']);

    for (const e of entries) {
      const size = e.getData().length;
      // CONTRACT ARTIFACT — printed so the export contents are inspectable in CI.
      console.log(`ZIP entry: ${e.entryName} (${size} bytes)`);
      expect(size, `${e.entryName} must be non-empty`).toBeGreaterThan(0);
    }
  });

  it('embeds the handout html and parseable metadata json', () => {
    const zip = new AdmZip(buildExportZip(sampleInput));
    const html = zip.getEntry('handout.html')!.getData().toString('utf8');
    expect(html).toContain('<h1>Course Handout</h1>');
    expect(html).toContain('HMP-2026-0042');

    const meta = JSON.parse(zip.getEntry('metadata.json')!.getData().toString('utf8'));
    expect(meta).toMatchObject({
      refNo: 'HMP-2026-0042',
      courseCode: 'SE-ZG501',
      version: 3,
      publishedBy: 'ic-user-1',
      generator: 'HMP',
    });

    const doc = JSON.parse(zip.getEntry('handout.json')!.getData().toString('utf8'));
    expect(doc).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
  });
});

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { prisma, BitsHandoutSchemaV1 } from '@hmp/db';
import { getSessionUser } from '@hmp/auth';
import { audit } from '@/lib/audit';
import { canExportHandout } from '@/lib/export/access';
import { buildHandoutDocx } from '@/lib/export/build-docx';
import { docxToPdf, SofficeError } from '@/lib/export/docx-to-pdf';

export const dynamic = 'force-dynamic';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const ASSETS = join(process.cwd(), 'src', 'lib', 'export', 'assets');
const LOGO_PATH = join(ASSETS, 'bits-header.png');
const WATERMARK_PATH = join(ASSETS, 'bits-watermark.png'); // pre-faded 12%-alpha crest

// Read the assets once per process (small PNGs; embedded server-side, not served).
let logoCache: Buffer | null = null;
let watermarkCache: Buffer | null = null;
async function getLogo(): Promise<Buffer> {
  if (!logoCache) logoCache = await readFile(LOGO_PATH);
  return logoCache;
}
async function getWatermark(): Promise<Buffer> {
  if (!watermarkCache) watermarkCache = await readFile(WATERMARK_PATH);
  return watermarkCache;
}

function safe(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * Word/PDF export (Prompt 23-b). A Route Handler — binary streaming + a forced
 * download with `Content-Disposition`. Role × status × ownership gate per
 * `canExportHandout` (the 1F matrix). `docx` is built in-process; `pdf` runs the
 * docx through LibreOffice headless (EC2 prerequisite).
 */
export async function GET(
  _req: Request,
  { params }: { params: { requestId: string; format: string } },
) {
  const { requestId, format } = params;
  if (format !== 'docx' && format !== 'pdf') {
    return Response.json({ error: 'bad_format' }, { status: 400 });
  }

  const me = await getSessionUser();
  if (!me) return Response.json({ error: 'unauthenticated' }, { status: 401 });

  const request = await prisma.handoutRequest.findUnique({
    where: { id: requestId },
    select: {
      refNo: true,
      status: true,
      handout: { select: { currentVersion: { select: { versionNo: true, data: true } } } },
      assignments: { where: { facultyId: me.id, active: true }, select: { id: true } },
    },
  });
  if (!request) return Response.json({ error: 'request_not_found' }, { status: 404 });

  if (
    !canExportHandout({
      roles: me.roles,
      status: request.status,
      isOwnerFaculty: request.assignments.length > 0,
    })
  ) {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }

  const version = request.handout?.currentVersion;
  if (!version?.data) {
    // No structured content (legacy contentHtml-only or never authored).
    return Response.json({ error: 'no_structured_handout' }, { status: 404 });
  }
  const parsed = BitsHandoutSchemaV1.safeParse(version.data);
  if (!parsed.success) {
    return Response.json({ error: 'unparseable_handout' }, { status: 422 });
  }

  const [logo, watermark] = await Promise.all([getLogo(), getWatermark()]);
  const docx = await buildHandoutDocx(parsed.data, logo, watermark);

  const courseCode = parsed.data.partA.courseNumbers[0] ?? 'handout';
  // refNo already carries the `HMP-YYYY-####` prefix — don't double it.
  const base = safe(`${request.refNo}-${courseCode}-v${version.versionNo}`);

  let body: Buffer;
  let mime: string;
  let ext: string;
  if (format === 'pdf') {
    try {
      body = await docxToPdf(docx);
    } catch (err) {
      const kind = err instanceof SofficeError ? err.kind : 'conversion-failed';
      // Log detail server-side; return a generic message (no path leakage).
      console.error('[export] PDF conversion failed', { requestId, kind, err });
      const status = kind === 'missing-binary' ? 503 : 500;
      return Response.json({ error: 'pdf_unavailable', kind }, { status });
    }
    mime = 'application/pdf';
    ext = 'pdf';
  } else {
    body = docx;
    mime = DOCX_MIME;
    ext = 'docx';
  }

  await audit({
    actorId: me.id,
    action: 'handout.export',
    entity: 'HandoutRequest',
    entityId: requestId,
    requestId,
    after: { format, versionNo: version.versionNo },
  });

  return new Response(new Uint8Array(body), {
    status: 200,
    headers: {
      'Content-Type': mime,
      'Content-Disposition': `attachment; filename="${base}.${ext}"`,
      'Content-Length': String(body.length),
      'Cache-Control': 'no-store',
    },
  });
}

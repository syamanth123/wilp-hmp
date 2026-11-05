import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { prisma, BitsHandoutSchemaV1 } from '@hmp/db';
import { getSessionUser } from '@hmp/auth';
import { audit } from '@/lib/audit';
import { PAST_HANDOUT_SCOPE } from '@/lib/handout-access';
import { buildHandoutDocx } from '@/lib/export/build-docx';
import { withPlainPlaceholders } from '@/lib/importer-placeholder';
import { docxToPdf, SofficeError } from '@/lib/export/docx-to-pdf';
import { exportErrorResponse } from '@/lib/export/error-response';

export const dynamic = 'force-dynamic';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const ASSETS = join(process.cwd(), 'src', 'lib', 'export', 'assets');

const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');

/**
 * Word / PDF download of a past BITS handout (Handout Library). Every signed-in role may read
 * the approved past handouts, so the only gate is the library's past-handout rule (approved for
 * reuse, parsed). Built by the same builder as HMP handouts; no draft mark (it was published).
 */
export async function GET(
  req: Request,
  { params }: { params: { importId: string; format: string } },
) {
  const { importId, format } = params;
  if (format !== 'docx' && format !== 'pdf') return exportErrorResponse(req, 400, 'bad_format');
  const me = await getSessionUser();
  if (!me) return exportErrorResponse(req, 401, 'unauthenticated');

  const row = await prisma.handoutImport.findFirst({
    where: { AND: [{ id: importId }, PAST_HANDOUT_SCOPE] },
    select: { id: true, bitsCourseNumber: true, data: true },
  });
  if (!row) return exportErrorResponse(req, 404, 'request_not_found');
  const parsed = BitsHandoutSchemaV1.safeParse(row.data);
  if (!parsed.success) return exportErrorResponse(req, 422, 'unparseable_handout');

  const [logo, watermark] = await Promise.all([
    readFile(join(ASSETS, 'bits-header.png')),
    readFile(join(ASSETS, 'bits-watermark.png')),
  ]);
  const docx = await buildHandoutDocx(withPlainPlaceholders(parsed.data), logo, watermark);
  const base = safe(`BITS-${row.bitsCourseNumber ?? 'handout'}-${parsed.data.metadata.semester}`);

  let body: Buffer = docx;
  let mime = DOCX_MIME;
  if (format === 'pdf') {
    try {
      body = await docxToPdf(docx);
    } catch (err) {
      const kind = err instanceof SofficeError ? err.kind : 'conversion-failed';
      console.error('[export] past handout PDF conversion failed', { importId, kind, err });
      return exportErrorResponse(req, kind === 'missing-binary' ? 503 : 500, 'pdf_unavailable', {
        kind,
      });
    }
    mime = 'application/pdf';
  }

  await audit({
    actorId: me.id,
    action: 'handout.past_export',
    entity: 'HandoutImport',
    entityId: row.id,
    after: { format },
  });

  return new Response(new Uint8Array(body), {
    status: 200,
    headers: {
      'Content-Type': mime,
      'Content-Disposition': `attachment; filename="${base}.${format}"`,
      'Content-Length': String(body.length),
      'Cache-Control': 'no-store',
    },
  });
}

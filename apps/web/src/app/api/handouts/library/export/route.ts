import ExcelJS from 'exceljs';
import { getSessionUser } from '@hmp/auth';
import { audit } from '@/lib/audit';
import { seesAllWork } from '@/lib/handout-access';
import { formatDate } from '@/lib/format-date';
import { groupMeta } from '@/lib/handout-library';
import { loadLibraryFromAddress } from '@/lib/handout-library-load';

export const dynamic = 'force-dynamic';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * "Export to Excel" (IC, HOG, PC, Admin): the filtered library list exactly as the page shows it
 * — the same address, the same access rule — one row per handout, no handout content.
 */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return new Response('Please sign in.', { status: 401 });
  if (!seesAllWork(user)) return new Response('Not available for your account.', { status: 403 });

  const url = new URL(req.url);
  const sp = Object.fromEntries(url.searchParams);
  const lib = await loadLibraryFromAddress(user, sp);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'HMP';
  const ws = wb.addWorksheet('Handouts');
  ws.columns = [
    { header: 'Course code', key: 'code', width: 14 },
    { header: 'Course title', key: 'title', width: 40 },
    { header: 'Semester', key: 'semester', width: 22 },
    { header: 'Programme', key: 'programme', width: 14 },
    { header: 'Status', key: 'status', width: 30 },
    { header: 'Faculty', key: 'faculty', width: 30 },
    { header: 'Subject expert', key: 'sme', width: 24 },
    { header: 'Due', key: 'due', width: 14 },
    { header: 'Last updated', key: 'updated', width: 14 },
    { header: 'Published', key: 'published', width: 14 },
    { header: 'HMP reference', key: 'ref', width: 16 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  for (const it of lib.items) {
    ws.addRow({
      code: it.courseCode,
      title: it.courseTitle,
      semester: it.semesterName,
      programme: it.programmeCode ?? it.programmes.join(', '),
      status: it.group ? groupMeta(it.group).label : 'Past BITS handout',
      faculty: it.faculty.join(', '),
      sme: it.sme ?? '',
      due: it.dueAt ? formatDate(it.dueAt) : '',
      updated: formatDate(it.updatedAt),
      published: it.publishedAt ? formatDate(it.publishedAt) : '',
      ref: it.refNo ?? '',
    });
  }
  const body = Buffer.from(await wb.xlsx.writeBuffer());

  await audit({
    actorId: user.id,
    action: 'library.export',
    entity: 'HandoutLibrary',
    entityId: user.id,
    after: { query: url.search, rows: lib.items.length },
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(new Uint8Array(body), {
    status: 200,
    headers: {
      'Content-Type': XLSX_MIME,
      'Content-Disposition': `attachment; filename="handout-library-${lib.filter.tab}-${stamp}.xlsx"`,
      'Content-Length': String(body.length),
      'Cache-Control': 'no-store',
    },
  });
}

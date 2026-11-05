import ExcelJS from 'exceljs';
import { RoleName } from '@hmp/db';
import { getSessionUser, hasRole } from '@hmp/auth';
import { ITEM_LABEL, loadRun } from '@/lib/taxila-runs';

export const dynamic = 'force-dynamic';

/** The bulk run as Excel — one row per course, with the reason (v1.3.0). IC / Admin only. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const me = await getSessionUser();
  if (!me) return new Response('Sign in first.', { status: 401 });
  if (!hasRole(me, RoleName.INSTRUCTION_CELL)) return new Response('Not allowed.', { status: 403 });
  const run = await loadRun(params.id);
  if (!run) return new Response('No such run.', { status: 404 });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`Taxila ${run.semesterCode}`);
  ws.columns = [
    { header: '#', key: 'n', width: 5 },
    { header: 'Course code(s)', key: 'codes', width: 28 },
    { header: 'Course title', key: 'title', width: 36 },
    { header: 'HMP reference', key: 'ref', width: 16 },
    { header: 'Semester', key: 'semester', width: 16 },
    { header: 'Result', key: 'result', width: 20 },
    { header: 'Reason / message', key: 'message', width: 50 },
    { header: 'File name', key: 'file', width: 50 },
    { header: 'Taxila course', key: 'course', width: 40 },
    { header: 'Taxila course id', key: 'courseId', width: 14 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  for (const r of run.rows) {
    ws.addRow({
      n: r.position,
      codes: r.codes.join(' / '),
      title: r.courseTitle,
      ref: r.refNo,
      semester: r.semesterName,
      result: ITEM_LABEL[r.status],
      message: r.message ?? '',
      file: r.fileName ?? '',
      course: r.courseFullname ?? '',
      courseId: r.taxilaCourseId ?? '',
    });
  }
  const body = Buffer.from(await wb.xlsx.writeBuffer());
  const stamp = run.createdAt.toISOString().slice(0, 10);
  return new Response(new Uint8Array(body), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="taxila-bulk-${run.semesterCode}-${stamp}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}

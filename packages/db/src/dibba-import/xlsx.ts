import ExcelJS from 'exceljs';
import { findDibbaCourseCodes } from '../course-code';
import type { FacultyRow, XlsxDibbaRow } from './types';

/**
 * Course Dibba Excel readers (Phase 2). Pure: workbook bytes in, rows out.
 * Server-only (exceljs) — import via `@hmp/db/src/dibba-import`.
 *
 * Both readers address columns BY HEADER NAME, never by letter: the sheet's
 * `Course No.` column is a CONCATENATE formula whose cached result may be
 * absent, so the code is rebuilt from `Subject` + `Catalog` (spec §5.6).
 */

export type XlsxInput = { path: string } | { buffer: Buffer };

async function loadWorkbook(input: XlsxInput): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  if ('path' in input) await wb.xlsx.readFile(input.path);
  else await wb.xlsx.load(input.buffer as unknown as ExcelJS.Buffer);
  return wb;
}

/** Text of an exceljs cell value, whatever shape it arrived in. */
function cellText(v: ExcelJS.CellValue | undefined): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('richText' in v)
      return v.richText
        .map((r) => r.text)
        .join('')
        .trim();
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue);
    if ('text' in v) return cellText(v.text as ExcelJS.CellValue);
    if ('error' in v) return '';
  }
  return String(v).trim();
}

/** header name (trimmed) → 1-based column index, from row 1 of a worksheet. */
function headerIndex(ws: ExcelJS.Worksheet): Map<string, number> {
  const map = new Map<string, number>();
  ws.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
    const name = cellText(cell.value);
    if (name && !map.has(name)) map.set(name, col);
  });
  return map;
}

function rowReader(ws: ExcelJS.Worksheet, headers: Map<string, number>) {
  return (rowNo: number) => {
    const row = ws.getRow(rowNo);
    return (header: string): string => {
      const col = headers.get(header);
      return col === undefined ? '' : cellText(row.getCell(col).value);
    };
  };
}

const toInt = (s: string): number | null => (/^\d+$/.test(s) ? parseInt(s, 10) : null);

/**
 * Read the `Course Dibba S1-…` sheet (first sheet whose name starts with
 * "Course Dibba"). One row per programme × admit batch × course.
 */
export async function parseDibbaXlsx(input: XlsxInput): Promise<XlsxDibbaRow[]> {
  const wb = await loadWorkbook(input);
  const ws = wb.worksheets.find((w) => /^course dibba/i.test(w.name));
  if (!ws) {
    throw new Error(
      `No "Course Dibba …" sheet found; sheets: ${wb.worksheets.map((w) => w.name).join(', ')}`,
    );
  }
  const headers = headerIndex(ws);
  const required = ['Subject', 'Catalog', 'Admit Batch', 'Exam Slot'];
  const missing = required.filter((h) => !headers.has(h));
  if (missing.length > 0) {
    throw new Error(`Course Dibba sheet is missing column(s): ${missing.join(', ')}`);
  }
  const read = rowReader(ws, headers);
  const out: XlsxDibbaRow[] = [];
  for (let r = 2; r <= ws.rowCount; r += 1) {
    const get = read(r);
    const subject = get('Subject');
    if (!subject) continue;
    const found = findDibbaCourseCodes(`${subject}${get('Catalog')}`)[0];
    if (!found) continue;
    out.push({
      acadPlan: get('Acad Plan'),
      degree: get('Degree Programme'),
      programme: get('Programme'),
      admitBatch: get('Admit Batch').replace(/\|/g, '/'),
      degreeSemester: get('Degree Semester'),
      studentCountRaw: get('Active Student No.'),
      domain: get('Domain'),
      courseTypeRaw: get('Type').toUpperCase(),
      slotNo: toInt(get('Exam Slot')),
      erpCourseId: get('Course ID') || null,
      courseCode: found.code,
      courseTitle: get('Unique Title') || get('Descr'),
      minUnits: get('Min Units'),
      remarks: get('Remarks'),
    });
  }
  return out;
}

/**
 * Shared core for the faculty → course map (spec §6): takes already-tabular
 * records keyed by header so the Excel `Sheet3` reader and a CSV upload with
 * the same headers produce identical rows (single-vs-batch consistency rule).
 * Headers are matched after trimming (`dabba ` has a trailing space in the
 * source) and case-insensitively. The Mobile column is deliberately never read.
 */
export function facultyRowsFromRecords(records: Array<Record<string, string>>): FacultyRow[] {
  const out: FacultyRow[] = [];
  for (const rec of records) {
    const get = (name: string): string => {
      const key = Object.keys(rec).find((k) => k.trim().toLowerCase() === name.toLowerCase());
      return key === undefined ? '' : (rec[key] ?? '').trim();
    };
    const found = findDibbaCourseCodes(get('Course Number') || get('course_code'))[0];
    if (!found) continue;
    const rawName = get('FACULTY NAME') || get('faculty_name');
    const email = (get('Email') || get('email')).toLowerCase();
    out.push({
      courseCode: found.code,
      slotNo: toInt(get('dabba') || get('slot')),
      facultyName: rawName
        .replace(/\s*\(LEAD\)\s*/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
      isLead: /\(LEAD\)/i.test(rawName) || /^true$/i.test(get('is_lead')),
      email: email || null,
      psrnOrGfid: get('PSRN/GFID') || get('psrn_or_gfid') || null,
      department: get('Department') || get('department') || null,
      campus: get('campus') || get('campus') || null,
    });
  }
  return out;
}

/** Read the faculty → course map from the workbook's `Sheet3`. */
export async function parseFacultySheet(
  input: XlsxInput,
  sheetName = 'Sheet3',
): Promise<FacultyRow[]> {
  const wb = await loadWorkbook(input);
  const ws = wb.getWorksheet(sheetName);
  if (!ws) {
    throw new Error(
      `No "${sheetName}" sheet found; sheets: ${wb.worksheets.map((w) => w.name).join(', ')}`,
    );
  }
  const headers = headerIndex(ws);
  const names = [...headers.keys()];
  const records: Array<Record<string, string>> = [];
  for (let r = 2; r <= ws.rowCount; r += 1) {
    const row = ws.getRow(r);
    const rec: Record<string, string> = {};
    for (const name of names) {
      if (/mobile|phone/i.test(name)) continue; // never read personal phone numbers
      const col = headers.get(name)!;
      rec[name] = cellText(row.getCell(col).value);
    }
    records.push(rec);
  }
  return facultyRowsFromRecords(records);
}

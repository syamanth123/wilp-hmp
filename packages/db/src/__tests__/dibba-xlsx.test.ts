import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { parseDibbaXlsx, parseFacultySheet, facultyRowsFromRecords } from '../dibba-import';

// Course Dibba Phase 2 — Excel readers. The unit tests build a workbook IN
// MEMORY with exceljs (no binary fixture needed); the real-file goldens
// probe-skip unless the originals sit in the gitignored local-data/ (the 2024
// workbook carries faculty phone numbers and never enters git).

const FIXTURES = join(__dirname, '..', '__fixtures__', 'dibba');
const LOCAL_XLSX = join(__dirname, '..', '..', '..', '..', 'local-data', 'course-dibba-2024.xlsx');

/** Tiny CSV reader for the synthetic faculty fixture (no quoted fields in it). */
function readSimpleCsv(path: string): Record<string, string>[] {
  const lines = readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.length > 0);
  const header = (lines[0] ?? '').split(',');
  return lines.slice(1).map((l) => {
    const cols = l.split(',');
    return Object.fromEntries(header.map((h, i) => [h, cols[i] ?? '']));
  });
}

async function syntheticWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const dibba = wb.addWorksheet('Course Dibba S1-2024');
  dibba.addRow([
    'Acad Plan',
    'Degree Programme',
    'Programme',
    'Admit Batch',
    'Degree Semester',
    'Active Student No.',
    'Domain',
    'Type',
    'Exam Slot',
    'Course ID',
    'Course No.',
    'Subject',
    'Catalog',
    'Descr',
    'Unique Title',
    'Min Units',
    'Remarks',
  ]);
  // Course No. is a CONCATENATE formula WITHOUT a cached result — the reader must rebuild from Subject+Catalog.
  dibba.addRow([
    'TH55',
    'M.Tech.',
    'Automotive Engineering',
    '1|2024',
    1,
    'New ADM',
    'CORE ENGG',
    'CORE',
    1,
    505648,
    { formula: 'CONCATENATE(L2," ",M2)' },
    'AE',
    'ZG516',
    'ADVANCE IN IC ENGINES',
    'ADVANCE IN IC ENGINES',
    4,
    '',
  ]);
  dibba.addRow([
    '18BT/18ET',
    'B.Tech.',
    'Engineering Technology',
    '2|2023',
    2,
    453,
    'CORE ENGG',
    'core',
    4,
    500069,
    'AAOC ZC111',
    'AAOC',
    'ZC111',
    'PROB & STAT',
    'PROBABILITY & STATISTICS',
    3,
    '# for ADAS',
  ]);
  dibba.addRow([
    'HT12',
    'M.Tech.',
    'Software Systems',
    'Backlog',
    'Backlog',
    'Backlog',
    'CSIS',
    'T COURSE',
    0,
    506410,
    '',
    'SS',
    'ZG628T',
    'DISSERTATION',
    'DISSERTATION',
    16,
    '',
  ]);
  dibba.addRow(['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']); // blank → skipped
  const faculty = wb.addWorksheet('Sheet3');
  const rows = readSimpleCsv(join(FIXTURES, 'faculty-synthetic.csv'));
  const headers = Object.keys(rows[0]!);
  faculty.addRow(headers);
  for (const r of rows) faculty.addRow(headers.map((h) => r[h] ?? ''));
  wb.addWorksheet('Not Offered').addRow(['derived view — ignored']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('parseDibbaXlsx (synthetic workbook)', () => {
  it('reads by header name, rebuilds the code from Subject+Catalog, converts | batches and keeps slot 0', async () => {
    const rows = await parseDibbaXlsx({ buffer: await syntheticWorkbook() });
    expect(
      rows.map(
        (r) => `${r.acadPlan}|${r.admitBatch}|${r.slotNo}|${r.courseCode}|${r.courseTypeRaw}`,
      ),
    ).toEqual([
      'TH55|1/2024|1|AE ZG516|CORE',
      '18BT/18ET|2/2023|4|AAOC ZC111|CORE',
      'HT12|Backlog|0|SS ZG628T|T COURSE',
    ]);
    expect(rows[0]).toMatchObject({
      studentCountRaw: 'New ADM',
      erpCourseId: '505648',
      minUnits: '4',
    });
    expect(rows[1]).toMatchObject({
      studentCountRaw: '453',
      courseTitle: 'PROBABILITY & STATISTICS',
      remarks: '# for ADAS',
    });
  });

  it('throws a clear error when the Course Dibba sheet is absent', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Something else');
    await expect(
      parseDibbaXlsx({ buffer: Buffer.from(await wb.xlsx.writeBuffer()) }),
    ).rejects.toThrow(/No "Course Dibba …" sheet/);
  });
});

describe('faculty sheet (synthetic)', () => {
  it('Sheet3 and the equivalent CSV produce IDENTICAL rows (shared core), and the Mobile column never leaks', async () => {
    const fromXlsx = await parseFacultySheet({ buffer: await syntheticWorkbook() });
    const fromCsv = facultyRowsFromRecords(readSimpleCsv(join(FIXTURES, 'faculty-synthetic.csv')));
    expect(fromXlsx).toEqual(fromCsv);
    // 11 CSV rows: 1 has no course code (NOTACODE) → 10
    expect(fromCsv).toHaveLength(10);
    const json = JSON.stringify(fromCsv);
    for (const phone of ['9000000001', '9000000002', '9000000004', '9000000005', '9000000008']) {
      expect(json).not.toContain(phone);
    }
    expect(Object.keys(fromCsv[0]!)).not.toContain('mobile');
  });

  it('normalizes codes, strips (LEAD), lower-cases emails, nulls blanks', () => {
    const rows = facultyRowsFromRecords(readSimpleCsv(join(FIXTURES, 'faculty-synthetic.csv')));
    const byKey = (code: string, name: string) =>
      rows.find((r) => r.courseCode === code && r.facultyName === name);
    expect(byKey('AE ZG516', 'BETA TWO')).toMatchObject({
      isLead: true,
      email: 'beta.two@example.edu',
      slotNo: 1,
    });
    expect(byKey('AE ZG516', 'ALPHA ONE')).toMatchObject({ isLead: false });
    expect(rows.filter((r) => r.courseCode === 'AE ZG516')).toHaveLength(2); // shared course
    expect(byKey('SS ZG628T', 'DELTA FOUR')).toMatchObject({ email: null, slotNo: 0 });
    expect(byKey('POWAB ZC113', 'EPSILON FIVE')).toMatchObject({ isLead: true });
    expect(byKey('EEE ZG571', 'ZETA SIX')).toBeDefined(); // split-digit code normalized
    expect(byKey('HHSM ZG513', 'TEAM CMC')).toMatchObject({ email: null, campus: 'CMC' });
    expect(byKey('MBA ZG566', '')).toMatchObject({ email: null, psrnOrGfid: null }); // course with no faculty yet
    // same person on two cross-listed codes — Phase 5 must NOT treat this as a clash
    expect(
      rows
        .filter((r) => r.facultyName === 'GAMMA THREE')
        .map((r) => r.courseCode)
        .sort(),
    ).toEqual(['AAOC ZC111', 'SS ZC111']);
  });
});

const localIt = existsSync(LOCAL_XLSX) ? it : it.skip;
describe('GOLDEN (local-data only): real 2024 Excel Dibba', () => {
  localIt(
    'Course Dibba sheet → 937 rows; Sheet3 → 545 faculty rows, 526 with an email',
    async () => {
      const dibba = await parseDibbaXlsx({ path: LOCAL_XLSX });
      const faculty = await parseFacultySheet({ path: LOCAL_XLSX });
      const summary = `dibba rows=${dibba.length} (expected 937); faculty rows=${faculty.length} (expected 545); with email=${faculty.filter((f) => f.email).length} (expected 526)`;
      expect(dibba.length, summary).toBe(937);
      expect(faculty.length, summary).toBe(545);
      expect(faculty.filter((f) => f.email).length, summary).toBe(526);
      // no phone number can be present: every value is a code/name/email/id/campus
      expect(JSON.stringify(faculty)).not.toMatch(/\b[6-9]\d{9}\b/);
    },
    60_000,
  );
});

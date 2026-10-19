import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { parseDibbaXlsx, parseDibbaXlsxDetailed, xlsxRowToDibbaRow } from '../dibba-import';
import { classifyDibbaWarning } from '../dibba-warnings';

// Course Dibba Phase 3 — the Excel path made observable (parseDibbaXlsxDetailed)
// and mapped onto the Word parser's DibbaRow shape (xlsxRowToDibbaRow).

const LOCAL_XLSX = join(__dirname, '..', '..', '..', '..', 'local-data', 'course-dibba-2024.xlsx');

const HEADERS = [
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
];

async function workbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Course Dibba S1-2024');
  ws.addRow(HEADERS);
  // 2: core, new admission, slot 1
  ws.addRow([
    'TH55',
    'M.Tech.',
    'Automotive Engineering',
    '1|2024',
    1,
    'New ADM',
    'CORE ENGG',
    'Core',
    1,
    505648,
    '',
    'AE',
    'ZG516',
    'ADV IC',
    'ADVANCE IN IC ENGINES',
    4,
    '',
  ]);
  // 3: elective ("EL"), 453 students, slot 4
  ws.addRow([
    '18BT/18ET',
    'B.Tech.',
    'Engineering Technology',
    '2|2023',
    2,
    453,
    'CORE ENGG',
    'EL',
    4,
    500069,
    '',
    'AAOC',
    'ZC111',
    'PROB & STAT',
    'PROBABILITY & STATISTICS',
    3,
    '# for ADAS',
  ]);
  // 4: backlog dissertation, slot 0 written in the sheet
  ws.addRow([
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
  // 5: unreadable Exam Slot
  ws.addRow([
    'HB28',
    'MBA',
    'Hospital Mgmt',
    '2|2024',
    3,
    100,
    'MGMT',
    'Core',
    'TBD',
    501000,
    '',
    'MBA',
    'ZG523',
    'OPS',
    'OPERATIONS',
    3,
    '',
  ]);
  // 6: not offered
  ws.addRow([
    'HB28',
    'MBA',
    'Hospital Mgmt',
    '2|2024',
    3,
    100,
    'MGMT',
    'Not Offered',
    2,
    501001,
    '',
    'MBA',
    'ZG524',
    'HRM',
    'HUMAN RESOURCES',
    3,
    '',
  ]);
  // 7: no readable course code → dropped WITH a warning
  ws.addRow([
    'PD59',
    'PG Diploma',
    'Finance',
    '1|2024',
    1,
    20,
    'FIN',
    'Core',
    3,
    502000,
    '',
    'XX',
    '123',
    'MYSTERY',
    'MYSTERY',
    3,
    '',
  ]);
  // 8: blank spacing row → skipped silently
  ws.addRow(HEADERS.map(() => ''));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('parseDibbaXlsxDetailed', () => {
  it('returns the same rows as parseDibbaXlsx plus a warning per dropped row / unreadable slot', async () => {
    const buffer = await workbook();
    const detailed = await parseDibbaXlsxDetailed({ buffer });
    expect(detailed.rows).toEqual(await parseDibbaXlsx({ buffer }));
    expect(detailed.rows.map((r) => r.courseCode)).toEqual([
      'AE ZG516',
      'AAOC ZC111',
      'SS ZG628T',
      'MBA ZG523',
      'MBA ZG524',
    ]);
    expect(detailed.sheetRowCount).toBe(7);
    expect(detailed.warnings).toEqual([
      "sheet row 5 MBA ZG523: Exam Slot is not a number ('TBD') — stored with no slot",
      "sheet row 7: dropped: no readable course code in 'XX 123'",
    ]);
    expect(detailed.warnings.map(classifyDibbaWarning)).toEqual([
      'xlsx-bad-slot',
      'xlsx-dropped-row',
    ]);
  });
});

describe('xlsxRowToDibbaRow', () => {
  it('maps every column per the spec vocabulary', async () => {
    const rows = (await parseDibbaXlsx({ buffer: await workbook() })).map(xlsxRowToDibbaRow);
    expect(rows[0]).toEqual({
      programmeCode: 'TH55',
      programmeTitle: 'M.Tech. Automotive Engineering',
      admitBatch: '1/2024',
      isNewAdmission: true,
      isBacklogRow: false,
      studentCount: null,
      slotNo: 1,
      slotDay: 'SAT',
      slotSession: 'FN',
      courseCode: 'AE ZG516',
      courseTitle: 'ADVANCE IN IC ENGINES',
      courseType: 'CORE',
      erpCourseId: '505648',
      classTimeHint: null,
      remarks: null,
      rawCell: 'AE ZG516|ADVANCE IN IC ENGINES',
    });
    expect(rows[1]).toMatchObject({
      programmeCode: '18BT/18ET',
      admitBatch: '2/2023',
      studentCount: 453,
      slotNo: 4,
      slotDay: 'SUN',
      slotSession: 'AN',
      courseType: 'ELECTIVE',
      remarks: '# for ADAS',
    });
    // backlog dissertation: slot 0 → no day/session. The Type TEXT ('T COURSE' +
    // trailing-T code) decides courseType = PROJECT; the batch's backlog status is
    // carried by isBacklogRow, exactly as the Word parser does (review finding).
    expect(rows[2]).toMatchObject({
      admitBatch: null,
      isBacklogRow: true,
      studentCount: null,
      slotNo: 0,
      slotDay: null,
      slotSession: null,
      courseType: 'PROJECT',
    });
    // unreadable slot → 0 (the reader warned), type still CORE
    expect(rows[3]).toMatchObject({
      slotNo: 0,
      slotDay: null,
      courseType: 'CORE',
      studentCount: 100,
    });
    expect(rows[4]).toMatchObject({
      slotNo: 2,
      slotDay: 'SAT',
      slotSession: 'AN',
      courseType: 'NOT_OFFERED',
    });
  });

  it('a non-backlog trailing-T code is PROJECT; unknown type text is UNSPECIFIED', () => {
    const base = {
      acadPlan: 'HT12',
      degree: 'M.Tech.',
      programme: 'Software Systems',
      admitBatch: '2/2023',
      degreeSemester: '3',
      studentCountRaw: '12',
      domain: 'CSIS',
      courseTypeRaw: 'T COURSE',
      slotNo: 0,
      erpCourseId: null,
      courseCode: 'SS ZG628T',
      courseTitle: 'DISSERTATION',
      minUnits: '16',
      remarks: '',
    };
    expect(xlsxRowToDibbaRow(base).courseType).toBe('PROJECT');
    expect(
      xlsxRowToDibbaRow({ ...base, courseCode: 'SS ZG628', courseTypeRaw: 'WHATEVER' }).courseType,
    ).toBe('UNSPECIFIED');
  });
});

const localIt = existsSync(LOCAL_XLSX) ? it : it.skip;
describe('GOLDEN (local-data only): real 2024 Excel Dibba through the detailed reader', () => {
  localIt(
    'still 937 rows; every warning is an xlsx family; the mapper never throws',
    async () => {
      const detailed = await parseDibbaXlsxDetailed({ path: LOCAL_XLSX });
      const summary = `rows=${detailed.rows.length} (expected 937); sheetRows=${detailed.sheetRowCount}; warnings=${detailed.warnings.length}\n${detailed.warnings.slice(0, 10).join('\n')}`;
      expect(detailed.rows.length, summary).toBe(937);
      for (const w of detailed.warnings) {
        expect(['xlsx-dropped-row', 'xlsx-bad-slot'], summary).toContain(classifyDibbaWarning(w));
      }
      const mapped = detailed.rows.map(xlsxRowToDibbaRow);
      expect(
        mapped.every((r) => r.slotNo >= 0 && r.slotNo <= 8),
        summary,
      ).toBe(true);
      expect(new Set(mapped.map((r) => r.courseType)).size, summary).toBeGreaterThan(1);
    },
    60_000,
  );
});

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  htmlTablesToGrids,
  parseSlotHeader,
  parseBatchCell,
  programmeCodeOf,
  parseDibbaHtml,
  parseDibbaDocx,
} from '../dibba-import';

// Course Dibba Phase 2 — pure parser tests. No PrismaClient, no I/O except the
// committed fixtures. Rules under test are the prototype's (parse_dibba.py),
// proven on the real 2025 file; the golden numbers below are FROZEN — if the
// parser disagrees, the test prints the first differing rows so the cause can
// be explained, and the numbers are never adjusted to make it pass.

const FIXTURES = join(__dirname, '..', '__fixtures__', 'dibba');
const DOCX = join(FIXTURES, 'course-dibba-2025-s1.docx');
const REF_CSV = join(FIXTURES, 'dibba_S1_2025-26_from_doc.csv');
const REF_WARNINGS = join(FIXTURES, 'parse_warnings.txt');

// ---------------------------------------------------------------------------
// Unit: grid expansion honors merged cells
// ---------------------------------------------------------------------------
describe('htmlTablesToGrids (merged cells)', () => {
  it('expands colspan across columns and carries rowspan down, keeping one id per physical cell', () => {
    const html = `<table>
      <tr><td colspan="3"><p>HT01 M.Tech. (Embedded System)</p></td></tr>
      <tr><td><p>Admit Batch</p></td><td><p>SL1(SAT FN)</p></td><td><p>SL2(SAT AN)</p></td></tr>
      <tr><td rowspan="2"><p>2/2024</p><p>(178)</p></td><td><p>ES ZG525|AVIONICS</p></td><td><p>ES ZG554|RECONFIG</p></td></tr>
      <tr><td><p>ES ZG532|TESTABILITY</p></td><td></td></tr>
    </table>`;
    const { grids, warnings } = htmlTablesToGrids(html);
    expect(warnings).toEqual([]);
    expect(grids).toHaveLength(1);
    const g = grids[0]!;
    // title row: 3 grid positions, ONE physical cell
    expect(g[0]!.map((c) => c.text)).toEqual(Array(3).fill('HT01 M.Tech. (Embedded System)'));
    expect(new Set(g[0]!.map((c) => c.id)).size).toBe(1);
    // rowspan: the batch cell is present on BOTH data rows, same id
    expect(g[2]![0]!.text).toBe('2/2024\n(178)');
    expect(g[3]![0]!.id).toBe(g[2]![0]!.id);
    // and the second data row's slot cells stay in their true columns
    expect(g[3]![1]!.text).toBe('ES ZG532|TESTABILITY');
    expect(g[3]![2]!.text).toBe('');
  });

  it('flags a nested table instead of flattening it silently', () => {
    const { warnings } = htmlTablesToGrids(
      '<table><tr><td><table><tr><td>x</td></tr></table></td></tr></table>',
    );
    expect(warnings[0]).toMatch(/nested table/);
  });
});

// ---------------------------------------------------------------------------
// Unit: header / batch / programme rules (spec §5.2–§5.4)
// ---------------------------------------------------------------------------
describe('parseSlotHeader', () => {
  it.each([
    ['SL1(SAT FN)', 1, 'SAT', 'FN', null],
    ['SL7 (SAT EV)', 7, 'SAT', 'EV', null],
    ['SAT EN', 7, 'SAT', 'EV', null], // no SLn → standard map; EN is the EV typo-variant
    ['SUN (EN)', 8, 'SUN', 'EV', null],
    ['FRI AN', 6, 'FRI', 'AN', null],
  ])('%s → SL%d %s %s', (h, slot, day, ses, warn) => {
    const r = parseSlotHeader(h, 99);
    expect([r.slotNo, r.day, r.session, r.warning]).toEqual([slot, day, ses, warn]);
  });

  it('keeps SLn as written but WARNS when it disagrees with the standard map (HB28/HB59 cases)', () => {
    const r = parseSlotHeader('SL7(SAT FN)', 7);
    expect(r.slotNo).toBe(7);
    expect(r.day).toBe('SAT');
    expect(r.session).toBe('FN');
    expect(r.warning).toBe('header "SL7(SAT FN)" disagrees with standard slot map (SL7 vs SAT FN)');
  });

  it('falls back to the column position with a warning when nothing is parseable', () => {
    const r = parseSlotHeader('Slot', 3);
    expect(r.slotNo).toBe(3);
    expect(r.warning).toMatch(/inferred from column position/);
  });
});

describe('parseBatchCell', () => {
  it.each([
    ['1/2025 \n NEW ADM', '1/2025', true, false, null],
    ['2/2024 \n (178)', '2/2024', false, false, 178],
    ['2/2024\n502', '2/2024', false, false, 502],
    ['2/2020 (5092) (3rdSem) 3 core + EL (00)', '2/2020', false, false, 0], // 5092 = ERP term code, ignored
    ['2/2023 (5105) (1stSem) 2 Core + 2 EL', '2/2023', false, false, null],
    ['Backlog', null, false, true, null],
    ['2 / 2022', '2/2022', false, false, null],
  ])('%j', (txt, batch, newAdm, backlog, count) => {
    const r = parseBatchCell(txt);
    expect([r.admitBatch, r.isNewAdmission, r.isBacklogRow, r.studentCount]).toEqual([
      batch,
      newAdm,
      backlog,
      count,
    ]);
  });
});

describe('programmeCodeOf', () => {
  it.each([
    ['HB28 MBA (Hospital & Health Systems Management)', 'HB28'],
    ['18BT/18ET B.Tech. (Engineering Technology)', '18BT/18ET'],
    ['HT 31 M.Tech. Structural Engineering', 'HT31'],
    ['MB21/HB21 MBA (Business Analytics)', 'MB21/HB21'],
    ['PD59 PG Diploma (Finance)', 'PD59'],
    ['Index of programmes', ''],
  ])('%s → %s', (title, code) => {
    expect(programmeCodeOf(title)).toBe(code);
  });
});

// ---------------------------------------------------------------------------
// Unit: a miniature Dibba (merged title row + rowspan batch + multi-course cells)
// ---------------------------------------------------------------------------
describe('parseDibbaHtml on a miniature Dibba', () => {
  const html = `
    <table><tr><td><p>Index</p></td></tr></table>
    <table>
      <tr><td colspan="4"><p>HT01 M.Tech. (Embedded System)</p></td></tr>
      <tr><td><p>Admit Batch</p></td><td><p>SL1(SAT FN)</p></td><td><p>SL2 (SAT AN)</p></td><td><p>SL7(SAT FN)</p></td></tr>
      <tr><td><p>1/2025</p><p>NEW ADM</p></td><td><p>ES ZG611 : PROCESS ARCHITE AND DESIGN (CORE)</p></td><td></td><td><p>ESZC424|SOFTWARE FOR EMBEDDED SYSTEMS (CORE)</p></td></tr>
      <tr><td><p>2/2024</p><p>(172)</p></td><td><p>ESZG525 AVIONICS SYSTEMS Sat 8.20</p><p>ES ZG573|DIGITAL SIGNAL PROCESSING</p></td><td><p>1. 504303|IS ZC364|OPERATING SYSTEMS</p><p>2. 502222|IS ZC424|SOFTWARE FOR EMBEDDED</p></td><td><p>ES ZG571|OPTICAL COMMUNICATION (not Offered)</p></td></tr>
      <tr><td><p>2/2023</p><p>200</p></td><td><p>ESZG628T|DISSERTATION</p></td><td><p>NEW FACULTY REQUIRED</p></td><td></td></tr>
    </table>`;
  const result = parseDibbaHtml(html);

  it('counts tables and skips the index table (no header row → no rows)', () => {
    expect(result.tableCount).toBe(2);
    expect(result.rows.every((r) => r.programmeCode === 'HT01')).toBe(true);
  });

  it('reads one row per code, with titles, types, counts and class-time hints per the prototype rules', () => {
    const keys = result.rows.map((r) => `${r.admitBatch}|SL${r.slotNo}|${r.courseCode}`);
    expect(keys).toEqual([
      '1/2025|SL1|ES ZG611',
      '1/2025|SL7|ES ZC424',
      '2/2024|SL1|ES ZG525',
      '2/2024|SL1|ES ZG573',
      '2/2024|SL2|IS ZC364',
      '2/2024|SL2|IS ZC424',
      '2/2024|SL7|ES ZG571',
      '2/2023|SL1|ES ZG628T',
    ]);
    const byCode = Object.fromEntries(result.rows.map((r) => [r.courseCode, r]));
    expect(byCode['ES ZG611']).toMatchObject({
      courseTitle: 'PROCESS ARCHITE AND DESIGN',
      courseType: 'CORE',
      isNewAdmission: true,
      studentCount: null,
    });
    expect(byCode['ES ZG525']).toMatchObject({ classTimeHint: 'SAT 8:20', studentCount: 172 });
    expect(byCode['IS ZC364']).toMatchObject({
      erpCourseId: '504303',
      courseTitle: 'OPERATING SYSTEMS',
    });
    expect(byCode['IS ZC424']).toMatchObject({
      erpCourseId: '502222',
      courseTitle: 'SOFTWARE FOR EMBEDDED',
    });
    expect(byCode['ES ZG571']).toMatchObject({ courseType: 'NOT_OFFERED' });
    expect(byCode['ES ZG628T']).toMatchObject({ courseType: 'PROJECT', studentCount: 200 });
  });

  it('emits exactly the expected warnings: the SL7(SAT FN) header disagreement and the no-code cell', () => {
    expect(result.warnings).toEqual([
      'table 1 HT01 M.Tech. (Embedded System): header "SL7(SAT FN)" disagrees with standard slot map (SL7 vs SAT FN)',
      // programme is sliced to 30 chars in this warning (prototype rule) — the name is exactly 30
      "table 1 HT01 M.Tech. (Embedded System) batch 2/2023 SL2: no course code in 'NEW FACULTY REQUIRED'",
    ]);
  });
});

// ---------------------------------------------------------------------------
// GOLDEN: the real 2025 Dibba (committed as a pre-converted .docx)
// ---------------------------------------------------------------------------
/** Minimal RFC 4180 reader (quoted commas/newlines) — test-local to avoid a cross-package import. */
function readCsv(path: string): Record<string, string>[] {
  const text = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
  const records: string[][] = [];
  let field = '';
  let row: string[] = [];
  let q = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') q = false;
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      records.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    records.push(row);
  }
  const header = records[0] ?? [];
  return records.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

const goldenIt = existsSync(DOCX) ? it : it.skip;
describe('GOLDEN: real 2025 Course Dibba (course-dibba-2025-s1.docx)', () => {
  goldenIt(
    'parses 1,077 rows / 638 codes / 41 programmes / exactly 3 header warnings and matches the reference CSV row by row',
    async () => {
      const result = await parseDibbaDocx({ path: DOCX });
      const ref = readCsv(REF_CSV);
      const key = (r: {
        programmeCode: string;
        admitBatch: string | null;
        slotNo: number;
        courseCode: string;
      }) => `${r.programmeCode}|${r.admitBatch ?? ''}|${r.slotNo}|${r.courseCode}`;
      const got = result.rows.map(key);
      const want = ref.map((r) =>
        key({
          programmeCode: r['programme_code'] ?? '',
          admitBatch: r['admit_batch'] || null,
          slotNo: Number(r['slot']),
          courseCode: r['course_code'] ?? '',
        }),
      );

      // Diagnostics FIRST, so a mismatch explains itself instead of a bare count.
      const firstDiff: string[] = [];
      for (let i = 0; i < Math.max(got.length, want.length) && firstDiff.length < 12; i += 1) {
        if (got[i] !== want[i]) {
          firstDiff.push(
            `#${i}: expected ${want[i] ?? '(none)'} | got ${got[i] ?? '(none)'}` +
              (result.rows[i] ? ` | raw: ${result.rows[i]!.rawCell}` : ''),
          );
        }
      }
      const headerWarnings = result.warnings.filter((w) =>
        w.includes('disagrees with standard slot map'),
      );
      const noCodeWarnings = result.warnings.filter((w) => w.includes('no course code in'));
      const summary = [
        `rows: got ${got.length}, expected ${want.length}`,
        `unique codes: ${new Set(result.rows.map((r) => r.courseCode)).size} (expected 638)`,
        `programmes: ${new Set(result.rows.map((r) => r.programmeCode)).size} (expected 41)`,
        `tables: ${result.tableCount} (expected 51)`,
        `warnings: ${result.warnings.length} total; header=${headerWarnings.length} (expected 3), no-code=${noCodeWarnings.length} (expected 0)`,
        ...result.warnings.map((w) => `  warn: ${w}`),
        ...(firstDiff.length
          ? ['first differing rows:', ...firstDiff.map((d) => `  ${d}`)]
          : ['rows: identical']),
      ].join('\n');

      expect(firstDiff, summary).toEqual([]);
      expect(got.length, summary).toBe(1077);
      expect(new Set(result.rows.map((r) => r.courseCode)).size, summary).toBe(638);
      expect(new Set(result.rows.map((r) => r.programmeCode)).size, summary).toBe(41);
      expect(result.tableCount, summary).toBe(51);
      expect(noCodeWarnings, summary).toEqual([]);
      expect(headerWarnings, summary).toEqual(
        readFileSync(REF_WARNINGS, 'utf8')
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean),
      );
    },
    60_000,
  );
});

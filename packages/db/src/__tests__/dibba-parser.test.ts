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
// Regression cases from the Phase 2 adversarial review
// ---------------------------------------------------------------------------
describe('review regressions', () => {
  const T = (rows: string) => `<table>${rows}</table>`;
  const title = '<tr><td colspan="4"><p>HT02 M.Tech. (Environment Engineering)</p></td></tr>';

  it('a merged header cell warns ONCE and fans its slot out to every column it spans', () => {
    const r = parseDibbaHtml(
      T(
        title +
          '<tr><td>Admit Batch</td><td>SL1(SAT FN)</td><td colspan="2">SL7(SAT FN)</td></tr>' +
          '<tr><td>2/2024</td><td>ES ZG611|A</td><td>IS ZC364|B</td><td>IS ZC424|C</td></tr>',
      ),
    );
    expect(r.warnings.filter((w) => w.includes('disagrees'))).toHaveLength(1);
    expect(r.rows.map((x) => `SL${x.slotNo}|${x.courseCode}`)).toEqual([
      'SL1|ES ZG611',
      'SL7|IS ZC364',
      'SL7|IS ZC424',
    ]);
  });

  it('the column-position fallback uses the DISTINCT-cell index (prototype), not the grid index', () => {
    const r = parseDibbaHtml(
      T(
        title +
          '<tr><td>Admit Batch</td><td colspan="2">SL1(SAT FN)</td><td>Slot</td></tr>' +
          '<tr><td>2/2024</td><td>ES ZG611|A</td><td>IS ZC364|B</td><td>IS ZC424|C</td></tr>',
      ),
    );
    expect(r.warnings).toEqual([
      'table 0 HT02 M.Tech. (Environment Engineering): slot inferred from column position for header "Slot"',
    ]);
    expect(r.rows.map((x) => `SL${x.slotNo}`)).toEqual(['SL1', 'SL1', 'SL2']);
  });

  it('a merged "Admit Batch" label cell produces no bogus fallback warning and aligns data', () => {
    const r = parseDibbaHtml(
      T(
        title +
          '<tr><td colspan="2">Admit Batch</td><td>SL1(SAT FN)</td></tr>' +
          '<tr><td colspan="2">2/2024<p>(50)</p></td><td>ES ZG611|A</td></tr>',
      ),
    );
    expect(r.warnings).toEqual([]);
    expect(r.rows.map((x) => `SL${x.slotNo}|${x.studentCount}`)).toEqual(['SL1|50']);
  });

  it('a batch cell WIDER than the header label warns (the one case the prototype would misalign)', () => {
    const r = parseDibbaHtml(
      T(
        title +
          '<tr><td>Admit Batch</td><td>SL1(SAT FN)</td><td>SL2(SAT AN)</td></tr>' +
          '<tr><td colspan="2">2/2024</td><td>ES ZG611|A</td></tr>',
      ),
    );
    expect(r.warnings).toEqual([
      'table 0 HT02 M.Tech. (Environment Engi batch 2/2024: batch cell spans 2 columns (header label spans 1) — later cells keep their true slot',
    ]);
    expect(r.rows.map((x) => `SL${x.slotNo}`)).toEqual(['SL2']);
  });

  it('a heading-styled paragraph inside a cell still breaks the line (student count survives)', () => {
    const r = parseDibbaHtml(
      T(
        title +
          '<tr><td>Admit Batch</td><td>SL1(SAT FN)</td></tr>' +
          '<tr><td><p>2/2023</p><h4>200</h4><p>3 Core</p></td><td><strong>ES</strong> ZG611|A</td></tr>',
      ),
    );
    expect(r.rows[0]).toMatchObject({ studentCount: 200, courseCode: 'ES ZG611' });
  });

  it('a nested table is cut out and reported; the ENCLOSING table keeps all its rows and its number', () => {
    const r = parseDibbaHtml(
      '<table><tr><td>Index</td></tr></table>' +
        T(
          title +
            '<tr><td>Admit Batch</td><td>SL1(SAT FN)</td></tr>' +
            '<tr><td><table><tr><td>inner</td></tr></table>2/2024</td><td>ES ZG611|A</td></tr>' +
            '<tr><td>1/2025<p>NEW ADM</p></td><td>ES ZG612|B</td></tr>',
        ),
    );
    expect(r.tableCount).toBe(2);
    expect(r.warnings).toEqual(['table 1: nested table detected — its cells were ignored']);
    expect(r.rows.map((x) => `${x.admitBatch}|${x.courseCode}`)).toEqual([
      '2/2024|ES ZG611',
      '1/2025|ES ZG612',
    ]);
  });

  it('parseBatchCell blanks EVERY batch token, so a line-split second token cannot leak its year as a count', () => {
    expect(parseBatchCell('2/2024\n1/\n2025')).toMatchObject({
      admitBatch: '2/2024',
      studentCount: null,
    });
  });

  it('a no-code warning renders an absent batch exactly like the prototype ("batch  SL…")', () => {
    const r = parseDibbaHtml(
      T(
        title +
          '<tr><td>Admit Batch</td><td>SL1(SAT FN)</td></tr><tr><td>Backlog</td><td>TBD</td></tr>',
      ),
    );
    expect(r.warnings).toEqual([
      "table 0 HT02 M.Tech. (Environment Engi batch  SL1: no course code in 'TBD'",
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

/**
 * The prototype labelled every non-CORE/BACKLOG/NOT_OFFERED row
 * ELECTIVE_OR_UNSPECIFIED; the parser follows spec §5.5 instead (UNSPECIFIED,
 * and trailing-T codes → PROJECT ahead of CORE). This maps the reference label
 * to what the parser is REQUIRED to emit — it is a documented label change, not
 * a relaxation of the comparison.
 */
function expectedCourseType(csvType: string, code: string): string {
  if (csvType === 'NOT_OFFERED' || csvType === 'BACKLOG') return csvType;
  if (code.endsWith('T')) return 'PROJECT';
  return csvType === 'ELECTIVE_OR_UNSPECIFIED' ? 'UNSPECIFIED' : csvType;
}

/**
 * `course_title` is compared whitespace-normalized on BOTH sides. Cause: the
 * reference CSV came from python-docx, which keeps the Word document's raw
 * intra-line whitespace — NBSP (U+00A0, even trailing, which Python's
 * `.strip(' /|:')` leaves alone) and double spaces — in 15 of 1,077 titles
 * (e.g. "MATERIALS MANAGEMENT<NBSP>", "ADVANCED  DIGITAL SIGNAL PROCESSING").
 * Our parser collapses those on purpose: they are Word clutter, not
 * information, and would break search/sort/dedup in the product. Decision A,
 * 2026-10-01. The reference CSV is deliberately left as the honest record of
 * the prototype's output. The "clean titles" test below guards the other
 * direction so this tolerance can never hide clutter creeping INTO our output.
 */
const normTitle = (s: string): string => s.replace(/\s+/g, ' ').trim(); // \s covers U+00A0

/** Every reference column except `source`, in a fixed order, as comparable strings. */
const FIELDS = [
  'programme',
  'programme_code',
  'admit_batch',
  'is_new_admission',
  'is_backlog_row',
  'student_count',
  'slot',
  'slot_day',
  'slot_session',
  'course_code',
  'course_title',
  'course_type',
  'class_time_hint',
  'raw_cell',
] as const;

function fieldsOfRow(r: Awaited<ReturnType<typeof parseDibbaDocx>>['rows'][number]): string[] {
  return [
    r.programmeTitle.replace(/\s+/g, ' ').trim(),
    r.programmeCode,
    r.admitBatch ?? '',
    String(r.isNewAdmission),
    String(r.isBacklogRow),
    r.studentCount === null ? '' : String(r.studentCount),
    String(r.slotNo),
    r.slotDay ?? '',
    r.slotSession ?? '',
    r.courseCode,
    normTitle(r.courseTitle),
    r.courseType,
    r.classTimeHint ?? '',
    r.rawCell,
  ];
}

function fieldsOfCsv(r: Record<string, string>): string[] {
  return FIELDS.map((f) => {
    const v = r[f] ?? '';
    if (f === 'programme') return v.replace(/\s+/g, ' ').trim();
    if (f === 'is_new_admission' || f === 'is_backlog_row') return v === 'True' ? 'true' : 'false';
    if (f === 'course_title') return normTitle(v);
    if (f === 'course_type') return expectedCourseType(v, r['course_code'] ?? '');
    return v;
  });
}

const goldenIt = existsSync(DOCX) ? it : it.skip;
describe('GOLDEN: real 2025 Course Dibba (course-dibba-2025-s1.docx)', () => {
  goldenIt(
    'parses 1,077 rows / 638 codes / 41 programmes / exactly 3 header warnings and matches the reference CSV on every column',
    async () => {
      const result = await parseDibbaDocx({ path: DOCX });
      const ref = readCsv(REF_CSV);
      const got = result.rows.map(fieldsOfRow);
      const want = ref.map(fieldsOfCsv);

      // Diagnostics FIRST, so a mismatch explains itself (which fields, raw cell)
      // instead of a bare count. Expected values are never adjusted to pass.
      const firstDiff: string[] = [];
      for (let i = 0; i < Math.max(got.length, want.length) && firstDiff.length < 12; i += 1) {
        const g = got[i];
        const w = want[i];
        if (!g || !w) {
          firstDiff.push(
            `#${i}: ${!w ? 'EXTRA parsed row' : 'MISSING parsed row'}: ${(g ?? w)!.join('|')}`,
          );
          continue;
        }
        const bad = FIELDS.filter((_, k) => g[k] !== w[k]);
        if (bad.length > 0) {
          firstDiff.push(
            `#${i} [${bad.join(', ')}] ` +
              bad
                .map(
                  (f) =>
                    `${f}: expected ${JSON.stringify(w[FIELDS.indexOf(f)])} got ${JSON.stringify(g[FIELDS.indexOf(f)])}`,
                )
                .join('; '),
          );
        }
      }
      const headerWarnings = result.warnings.filter((w) =>
        w.includes('disagrees with standard slot map'),
      );
      const noCodeWarnings = result.warnings.filter((w) => w.includes('no course code in'));
      const spanWarnings = result.warnings.filter((w) => w.includes('spans'));
      const summary = [
        `rows: got ${got.length}, expected ${want.length}`,
        `unique codes: ${new Set(result.rows.map((r) => r.courseCode)).size} (expected 638)`,
        `programmes: ${new Set(result.rows.map((r) => r.programmeCode)).size} (expected 41)`,
        `tables: ${result.tableCount} (expected 51)`,
        `studentCount non-null: ${result.rows.filter((r) => r.studentCount !== null).length} (reference 767); classTimeHint non-null: ${result.rows.filter((r) => r.classTimeHint).length} (reference 22)`,
        `warnings: ${result.warnings.length} total; header=${headerWarnings.length} (expected 3), no-code=${noCodeWarnings.length} (expected 0), span=${spanWarnings.length}`,
        ...result.warnings.map((w) => `  warn: ${w}`),
        ...(firstDiff.length
          ? ['first differing rows (field: expected vs got):', ...firstDiff.map((d) => `  ${d}`)]
          : ['rows: identical on all 14 compared columns']),
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

  // Positive guard for the whitespace tolerance above: the comparison ignores
  // NBSP/double-space clutter in the REFERENCE, so this fails if any such
  // clutter ever appears in OUR output.
  goldenIt(
    'every parsed course_title is clean: no U+00A0, no double space, no leading/trailing whitespace',
    async () => {
      const result = await parseDibbaDocx({ path: DOCX });
      const NBSP = String.fromCharCode(0xa0);
      const dirty = result.rows
        .map((r, i) => ({ i, code: r.courseCode, title: r.courseTitle }))
        .filter(
          ({ title }) => title.includes(NBSP) || title.includes('  ') || title !== title.trim(),
        );
      expect(dirty, `dirty titles: ${JSON.stringify(dirty.slice(0, 10))}`).toEqual([]);
      expect(result.rows.length).toBe(1077);
    },
    60_000,
  );
});

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DIBBA_MAX_WARNINGS_PER_FAMILY,
  DIBBA_WARNING_FAMILIES,
  DIBBA_WARNING_MARKERS,
  DIBBA_WARNING_MATCH_ORDER,
  DIBBA_WARNING_MAX_CHARS,
  capDibbaWarnings,
  classifyDibbaWarning,
  countAcknowledgeableWarnings,
  groupDibbaWarnings,
  type DibbaWarningFamily,
} from '../dibba-warnings';
import { parseDibbaDocx, parseDibbaHtml } from '../dibba-import';

// Course Dibba Phase 3 — warning families. The classifier and the parsers share
// the marker strings, so the real proof is the third block: warnings PRODUCED
// by the parser classify as intended, no hand-copied literals involved.

const FIXTURES = join(__dirname, '..', '__fixtures__', 'dibba');
const DOCX = join(FIXTURES, 'course-dibba-2025-s1.docx');

describe('classifyDibbaWarning', () => {
  it('classifies the literal strings the emitters produce (copied from their own tests)', () => {
    const cases: Array<[string, DibbaWarningFamily]> = [
      ['table 1: nested table detected — its cells were ignored', 'nested-table'],
      [
        'table 0 HT02 M.Tech. (Environment Engineering): slot inferred from column position for header "Slot"',
        'inferred-slot',
      ],
      [
        'table 0 HT02 M.Tech. (Environment Engi batch 2/2024: batch cell spans 2 columns (header label spans 1) — later cells keep their true slot',
        'batch-cell',
      ],
      [
        'table 0 18BT/18ET B.Tech. (Engineering batch 1/2023: cell spans 2 slot columns (SL8..), assigned to SL8',
        'merged-cell',
      ],
      [
        'table 28 HB28 MBA (Hospital & Health Systems Mana: header "SL7(SAT FN)" disagrees with standard slot map (SL7 vs SAT FN)',
        'header',
      ],
      [
        "table 0 HT01 M.Tech. (Embedded System) batch 2/2023 SL2: no course code in 'NEW FACULTY REQUIRED'",
        'no-code',
      ],
      [
        'table 3: overlapping merged cells at row 2, column 1 — later cells may be shifted',
        'overlap-cell',
      ],
      ["sheet row 7: dropped: no readable course code in 'XX 123'", 'xlsx-dropped-row'],
      [
        "sheet row 9 AE ZG516: Exam Slot is not a number ('TBD') — stored with no slot",
        'xlsx-bad-slot',
      ],
      ['something new the parser might say one day', 'other'],
    ];
    for (const [w, family] of cases) expect(classifyDibbaWarning(w), w).toBe(family);
  });

  it('the three frozen header warnings of the 2025 file are "header"', () => {
    const lines = readFileSync(join(FIXTURES, 'parse_warnings.txt'), 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    expect(lines).toHaveLength(3);
    for (const l of lines) expect(classifyDibbaWarning(l)).toBe('header');
  });

  it('a no-code warning whose cell text mentions slot columns is still "no-code" (free text matched first)', () => {
    expect(
      classifyDibbaWarning("table 0 X batch 2/2024 SL1: no course code in 'see slot columns'"),
    ).toBe('no-code');
  });

  it('batch-cell precedes merged-cell (both contain "spans")', () => {
    expect(
      classifyDibbaWarning(
        't: batch cell spans 3 columns (header label spans 1) — later cells keep their true slot',
      ),
    ).toBe('batch-cell');
  });

  it('every marker has exactly one display entry (with "other" last) and exactly one match-order slot', () => {
    const families = DIBBA_WARNING_FAMILIES.map((f) => f.family);
    expect(new Set(families).size).toBe(families.length);
    expect(families[families.length - 1]).toBe('other');
    for (const key of Object.keys(DIBBA_WARNING_MARKERS)) expect(families).toContain(key);
    expect(families).toHaveLength(Object.keys(DIBBA_WARNING_MARKERS).length + 1);
    expect([...DIBBA_WARNING_MATCH_ORDER].sort()).toEqual(
      Object.keys(DIBBA_WARNING_MARKERS).sort(),
    );
  });

  it('a header whose own text contains another marker is still "header" (free-text families match first)', () => {
    expect(
      classifyDibbaWarning(
        'table 0 X: header "SL1 slot columns" disagrees with standard slot map (SL1 vs SAT AN)',
      ),
    ).toBe('header');
    expect(
      classifyDibbaWarning(
        'table 0 X: slot inferred from column position for header "nested table detected"',
      ),
    ).toBe('inferred-slot');
  });
});

describe('capDibbaWarnings', () => {
  const dropped = (i: number) => `sheet row ${i}: dropped: no readable course code in 'X ${i}'`;

  it('keeps everything untouched below the caps (the real files are far below them)', () => {
    const input = [
      "a: no course code in 'x'",
      'b: cell spans 2 slot columns (SL1..), assigned to SL1',
    ];
    expect(capDibbaWarnings(input)).toEqual(input);
  });

  it('caps each family at DIBBA_MAX_WARNINGS_PER_FAMILY with ONE summary line that re-classifies into the family', () => {
    const input = Array.from({ length: 1000 }, (_, i) => dropped(i));
    const out = capDibbaWarnings(input);
    expect(out).toHaveLength(DIBBA_MAX_WARNINGS_PER_FAMILY + 1);
    expect(out.slice(0, DIBBA_MAX_WARNINGS_PER_FAMILY)).toEqual(
      input.slice(0, DIBBA_MAX_WARNINGS_PER_FAMILY),
    );
    const summary = out[out.length - 1]!;
    expect(summary).toBe(`…and 800 more like this (${DIBBA_WARNING_MARKERS['xlsx-dropped-row']})`);
    expect(classifyDibbaWarning(summary)).toBe('xlsx-dropped-row');
    expect(countAcknowledgeableWarnings(out)).toBe(DIBBA_MAX_WARNINGS_PER_FAMILY + 1);
  });

  it('caps per family, not globally, and summarises unknown notes without a marker', () => {
    const input = [
      ...Array.from({ length: 250 }, (_, i) => dropped(i)),
      ...Array.from({ length: 250 }, (_, i) => `note ${i}`),
      'c: header "SL7(SAT FN)" disagrees with standard slot map (SL7 vs SAT FN)',
    ];
    const out = capDibbaWarnings(input);
    expect(out).toHaveLength(200 + 200 + 1 + 2);
    expect(out.filter((w) => classifyDibbaWarning(w) === 'other').pop()).toBe(
      '…and 50 more parser notes',
    );
    expect(out.filter((w) => classifyDibbaWarning(w) === 'header')).toHaveLength(1);
  });

  it('truncates a single oversized warning to DIBBA_WARNING_MAX_CHARS with an ellipsis', () => {
    const long = `t: no course code in '${'x'.repeat(2000)}'`;
    const [out] = capDibbaWarnings([long]);
    expect(out).toHaveLength(DIBBA_WARNING_MAX_CHARS + 1);
    expect(out!.endsWith('…')).toBe(true);
    expect(classifyDibbaWarning(out!)).toBe('no-code');
  });
});

describe('parser output classifies by construction (no copied literals)', () => {
  const T = (rows: string) => `<table>${rows}</table>`;
  const title = '<tr><td colspan="4"><p>HT02 M.Tech. (Environment Engineering)</p></td></tr>';

  it.each<[string, string, DibbaWarningFamily]>([
    [
      'header disagreement',
      '<tr><td>Admit Batch</td><td>SL7(SAT FN)</td></tr><tr><td>2/2024</td><td>ES ZG611|A</td></tr>',
      'header',
    ],
    [
      'inferred slot',
      '<tr><td>Admit Batch</td><td>Slot</td></tr><tr><td>2/2024</td><td>ES ZG611|A</td></tr>',
      'inferred-slot',
    ],
    [
      'no course code',
      '<tr><td>Admit Batch</td><td>SL1(SAT FN)</td></tr><tr><td>2/2024</td><td>NEW FACULTY REQUIRED</td></tr>',
      'no-code',
    ],
    [
      'batch cell wider than the header',
      '<tr><td>Admit Batch</td><td>SL1(SAT FN)</td><td>SL2(SAT AN)</td></tr><tr><td colspan="2">2/2024</td><td>ES ZG611|A</td></tr>',
      'batch-cell',
    ],
    [
      'merged data cell',
      '<tr><td>Admit Batch</td><td>SL1(SAT FN)</td><td>SL2(SAT AN)</td></tr><tr><td>2/2024</td><td colspan="2">ES ZG611|A</td></tr>',
      'merged-cell',
    ],
  ])('%s', (_name, rows, family) => {
    const r = parseDibbaHtml(T(title + rows));
    expect(r.warnings).toHaveLength(1);
    expect(classifyDibbaWarning(r.warnings[0]!)).toBe(family);
  });

  it('nested table', () => {
    const r = parseDibbaHtml('<table><tr><td><table><tr><td>x</td></tr></table></td></tr></table>');
    expect(r.warnings.map(classifyDibbaWarning)).toEqual(['nested-table']);
  });
});

describe('groupDibbaWarnings / countAcknowledgeableWarnings', () => {
  it('groups in family order, keeps input order inside a group, drops empty families', () => {
    const groups = groupDibbaWarnings([
      'table 0 X: header "SL7(SAT FN)" disagrees with standard slot map (SL7 vs SAT FN)',
      'table 0 X batch 1/2023: cell spans 2 slot columns (SL8..), assigned to SL8',
      'table 0 Y: header "SL8(SAT EN)" disagrees with standard slot map (SL8 vs SAT EV)',
      'brand new note',
    ]);
    expect(groups.map((g) => [g.family, g.warnings.length])).toEqual([
      ['merged-cell', 1],
      ['header', 2],
      ['other', 1],
    ]);
    expect(groups[1]!.warnings[0]).toContain('SL7(SAT FN)');
    expect(groups[0]!.severity).toBe('info');
  });

  it('counts everything except informational notes toward the publish acknowledgement', () => {
    expect(
      countAcknowledgeableWarnings([
        'table 0 X batch 1/2023: cell spans 2 slot columns (SL8..), assigned to SL8',
        'table 0 X: header "SL7(SAT FN)" disagrees with standard slot map (SL7 vs SAT FN)',
        'unknown note',
      ]),
    ).toBe(2);
  });

  const goldenIt = existsSync(DOCX) ? it : it.skip;
  goldenIt(
    'the real 2025 file is exactly { header: 3, merged-cell: 2 } — 3 to acknowledge, nothing "other"',
    async () => {
      const { warnings } = await parseDibbaDocx({ path: DOCX });
      const histogram: Record<string, number> = {};
      for (const w of warnings) {
        const f = classifyDibbaWarning(w);
        histogram[f] = (histogram[f] ?? 0) + 1;
      }
      expect(histogram, warnings.join('\n')).toEqual({ header: 3, 'merged-cell': 2 });
      expect(countAcknowledgeableWarnings(warnings)).toBe(3);
    },
    60_000,
  );
});

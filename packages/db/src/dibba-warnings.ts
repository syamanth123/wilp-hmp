/**
 * Course Dibba parser-warning families (Phase 3). Pure data + string matching,
 * no Node-only imports — exported from the top-level `@hmp/db` barrel (like
 * dibba-slots) so the IC preview (client bundle) and the server-only parsers
 * share ONE set of marker strings.
 *
 * Why markers: `DibbaParseResult.warnings` and `DibbaImport.warnings` are flat
 * strings by design (spec §5.3 — anomalies for IC to confirm, never silently
 * "fixed"). The parsers compose every message FROM these constants, and the
 * classifier matches ON them, so a wording change in one place cannot leave
 * the other behind. The golden fixtures (parse_warnings.txt, the literal
 * assertions in dibba-parser.test.ts) pin the full strings; dibba-warnings.test.ts
 * pins the family histogram of the real 2025 file ({ header: 3, 'merged-cell': 2 }).
 *
 * Two orders live here on purpose: DIBBA_WARNING_MATCH_ORDER (classifier scan —
 * families whose messages embed raw cell text come first, so a cell that
 * happens to contain another family's marker cannot be misfiled) and
 * DIBBA_WARNING_FAMILIES (display order on the preview).
 */

export type DibbaWarningFamily =
  | 'no-code'
  | 'xlsx-dropped-row'
  | 'xlsx-bad-slot'
  | 'batch-cell'
  | 'merged-cell'
  | 'overlap-cell'
  | 'header'
  | 'inferred-slot'
  | 'nested-table'
  | 'other';

/** `info` = shown, no action; `confirm` = IC must acknowledge before publish; `error` = rows may be missing/wrong. */
export type DibbaWarningSeverity = 'info' | 'confirm' | 'error';

/** The substring each emitter embeds and the classifier matches on. */
export const DIBBA_WARNING_MARKERS = {
  'no-code': 'no course code in',
  'xlsx-dropped-row': 'dropped: no readable course code',
  'xlsx-bad-slot': 'Exam Slot is not a number',
  'batch-cell': 'batch cell spans',
  'merged-cell': ' slot columns',
  'overlap-cell': 'overlapping merged cells',
  header: 'disagrees with standard slot map',
  'inferred-slot': 'inferred from column position',
  'nested-table': 'nested table detected',
} as const satisfies Record<Exclude<DibbaWarningFamily, 'other'>, string>;

/**
 * Classifier scan order (first marker found wins). Every family that echoes
 * raw cell/header text (no-code, the xlsx pair, header, inferred-slot) precedes
 * the structural markers so its payload can never be mistaken for one of them;
 * `batch-cell` precedes `merged-cell` because both contain "spans".
 */
export const DIBBA_WARNING_MATCH_ORDER = [
  'no-code',
  'xlsx-dropped-row',
  'xlsx-bad-slot',
  'batch-cell',
  'header',
  'inferred-slot',
  'merged-cell',
  'overlap-cell',
  'nested-table',
] as const satisfies readonly Exclude<DibbaWarningFamily, 'other'>[];

export interface DibbaWarningFamilyInfo {
  family: DibbaWarningFamily;
  severity: DibbaWarningSeverity;
  /** Group heading on the preview (sentence case, no count — the UI appends it). */
  title: string;
  /** One line under the heading explaining what the parser did. */
  explanation: string;
}

/** Families in DISPLAY order (the preview groups appear in this order). */
export const DIBBA_WARNING_FAMILIES: readonly DibbaWarningFamilyInfo[] = [
  {
    family: 'no-code',
    severity: 'error',
    title: 'Cells without a course code',
    explanation:
      'A non-empty cell had no readable course code, so no row was created for it. Check the printed Dibba.',
  },
  {
    family: 'xlsx-dropped-row',
    severity: 'error',
    title: 'Sheet rows without a course code',
    explanation:
      'The sheet has rows this import does not: their Subject/Catalog cells held no readable course code.',
  },
  {
    family: 'xlsx-bad-slot',
    severity: 'confirm',
    title: 'Unreadable exam slot',
    explanation: 'The Exam Slot cell was not a number; the row was stored with no slot (slot 0).',
  },
  {
    family: 'batch-cell',
    severity: 'confirm',
    title: 'Batch cell wider than the header',
    explanation:
      'The admit-batch cell spans more columns than the header label; later cells were kept in their true slot columns. Confirm the slots for this programme.',
  },
  {
    family: 'merged-cell',
    severity: 'info',
    title: 'Merged-cell notes',
    explanation:
      'A merged cell covered more than one slot column; it was assigned to the first slot. All rows parsed normally.',
  },
  {
    family: 'overlap-cell',
    severity: 'error',
    title: 'Overlapping merged cells',
    explanation:
      'Cells overlapped on the grid, so later cells in that table may have shifted slots.',
  },
  {
    family: 'header',
    severity: 'confirm',
    title: 'Header disagreements',
    explanation:
      "The sheet's SL number and its day/session disagree; the SL number was kept as written. Check the printed Dibba for these programmes.",
  },
  {
    family: 'inferred-slot',
    severity: 'confirm',
    title: 'Slot inferred from position',
    explanation:
      'A slot header could not be read, so the slot number was taken from the column position (column 1 = SL1).',
  },
  {
    family: 'nested-table',
    severity: 'error',
    title: 'Nested tables ignored',
    explanation: 'A table nested inside a cell was skipped; its contents are not in this import.',
  },
  {
    family: 'other',
    severity: 'confirm',
    title: 'Other parser notes',
    explanation: 'An unrecognised parser note, shown verbatim.',
  },
];

const FAMILY_INFO: ReadonlyMap<DibbaWarningFamily, DibbaWarningFamilyInfo> = new Map(
  DIBBA_WARNING_FAMILIES.map((f) => [f.family, f]),
);

/** Family of one warning string (DIBBA_WARNING_MATCH_ORDER; `other` when no marker is present). */
export function classifyDibbaWarning(warning: string): DibbaWarningFamily {
  for (const family of DIBBA_WARNING_MATCH_ORDER) {
    if (warning.includes(DIBBA_WARNING_MARKERS[family])) return family;
  }
  return 'other';
}

export function dibbaWarningFamilyInfo(family: DibbaWarningFamily): DibbaWarningFamilyInfo {
  return FAMILY_INFO.get(family)!;
}

export interface DibbaWarningGroup extends DibbaWarningFamilyInfo {
  warnings: string[];
}

/**
 * Group warnings by family, in DIBBA_WARNING_FAMILIES order, dropping empty
 * families. Input order is preserved inside each group.
 */
export function groupDibbaWarnings(warnings: readonly string[]): DibbaWarningGroup[] {
  const buckets = new Map<DibbaWarningFamily, string[]>();
  for (const w of warnings) {
    const family = classifyDibbaWarning(w);
    const list = buckets.get(family) ?? [];
    list.push(w);
    buckets.set(family, list);
  }
  return DIBBA_WARNING_FAMILIES.filter((f) => buckets.has(f.family)).map((f) => ({
    ...f,
    warnings: buckets.get(f.family)!,
  }));
}

/** Warnings IC must acknowledge before publishing (every family except `info`). */
export function countAcknowledgeableWarnings(warnings: readonly string[]): number {
  return warnings.filter((w) => dibbaWarningFamilyInfo(classifyDibbaWarning(w)).severity !== 'info')
    .length;
}

/** Longest single warning that is stored/rendered; longer ones are cut with an ellipsis. */
export const DIBBA_WARNING_MAX_CHARS = 500;
/** Warnings kept per family; the overflow becomes ONE summary line per family. */
export const DIBBA_MAX_WARNINGS_PER_FAMILY = 200;

/**
 * Bound what reaches `DibbaImport.warnings` (rendered in full on the preview,
 * D6): the byte and row caps do not bound warnings — a hostile sheet can emit
 * one per row, even with zero rows parsed. Keeps the first `perFamily` per
 * family in input order; the overflow collapses to one summary line per family
 * composed FROM that family's marker, so it classifies into the same family
 * and keeps its severity (and therefore its place in the acknowledgement count).
 * Applied once, in `createDibbaImport` — the single persistence chokepoint.
 * Never changes an input of ≤ `perFamily` warnings per family and ≤ `maxChars`
 * each (the real files are far below both).
 */
export function capDibbaWarnings(
  warnings: readonly string[],
  perFamily: number = DIBBA_MAX_WARNINGS_PER_FAMILY,
  maxChars: number = DIBBA_WARNING_MAX_CHARS,
): string[] {
  const kept: string[] = [];
  const seen = new Map<DibbaWarningFamily, number>();
  const overflow = new Map<DibbaWarningFamily, number>();
  for (const raw of warnings) {
    const family = classifyDibbaWarning(raw); // classify BEFORE truncating (markers sit early anyway)
    const n = (seen.get(family) ?? 0) + 1;
    seen.set(family, n);
    if (n > perFamily) {
      overflow.set(family, (overflow.get(family) ?? 0) + 1);
      continue;
    }
    kept.push(raw.length > maxChars ? `${raw.slice(0, maxChars)}…` : raw);
  }
  for (const [family, n] of overflow) {
    kept.push(
      family === 'other'
        ? `…and ${n} more parser notes`
        : `…and ${n} more like this (${DIBBA_WARNING_MARKERS[family]})`,
    );
  }
  return kept;
}

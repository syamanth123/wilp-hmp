import { z } from 'zod';

/**
 * Canonical BITS WILP course-number form: one ASCII space between the
 * 2-4 letter discipline prefix and the "ZC" or "ZG" cluster, followed by
 * 3-4 digits. Survey-driven (Prompt 11b): 92% of corpus codes match this exact
 * form unchanged; the remaining 8% are transcription quirks the normalizer
 * collapses to canonical (joined / extra-spaced / mid-digit run-split).
 */
const CANONICAL = /^([A-Z]{2,4}) (Z[CG])(\d{3,4})$/;
const STRIPPED = /^([A-Z]{2,4})(Z[CG])(\d{3,4})$/;

/**
 * Normalize a BITS course number to canonical form (e.g. `"AE ZG631"`).
 *
 * Handles the four real-world irregularities the 11b corpus survey found:
 * - already canonical (`"MBA ZC415"`)  → unchanged
 * - joined           (`"MBAZG501"`)    → `"MBA ZG501"`
 * - extra-spaced     (`"POM ZG 512"`)  → `"POM ZG512"`
 * - mid-digit split  (`"ST ZG55 1"`)   → `"ST ZG551"`
 * - lowercase input  (`"mba zc415"`)   → `"MBA ZC415"`
 *
 * Throws with an educational message naming the canonical example on anything
 * that doesn't reduce to the canonical shape (e.g. the legacy invented form
 * `"SE-ZG501"`, garbage, or empty input).
 */
export function normalizeBitsCourseNumber(input: string): string {
  if (typeof input !== 'string') {
    throw new Error(
      'Not a valid BITS course number: input must be a string. ' +
        'Expected format: "AE ZG510" (2-4 letter discipline, space, Z[CG], 3-4 digit code).',
    );
  }
  const stripped = input.toUpperCase().replace(/\s+/g, '');
  if (stripped.length === 0) {
    throw new Error(
      'Not a valid BITS course number: empty string. ' +
        'Expected format: "AE ZG510" (2-4 letter discipline, space, Z[CG], 3-4 digit code).',
    );
  }
  const m = stripped.match(STRIPPED);
  if (!m) {
    throw new Error(
      `Not a valid BITS course number: "${input}". ` +
        'Expected format: "AE ZG510" (2-4 letter discipline, space, Z[CG], 3-4 digit code).',
    );
  }
  return `${m[1]} ${m[2]}${m[3]}`;
}

/**
 * Course Dibba (Phase 2): a deliberately LENIENT sibling of
 * `normalizeBitsCourseNumber` for the Instruction Cell's schedule documents.
 * The 2024/2025 Dibbas carry two shapes the strict normalizer rejects BY DESIGN
 * (its tests assert both, so it must not be loosened): dissertation/project
 * codes with a trailing "T" (`SS ZG628T`, `BITS ZC425T`, `MBA ZG622T`) and
 * 5-letter prefixes (`POWAB ZC113`). Tolerates the same joined / extra-spaced /
 * split-digit / lowercase quirks as the strict one. Canonical form:
 * `PREFIX Z[CG]nnn[T]`. Course rows still go through the strict normalizer;
 * Dibba codes are matched to the catalogue by equality against
 * `bitsCourseNumber` / `alternateCodes`, and unmatched codes surface in the
 * import preview as "not in HMP catalogue".
 */
const DIBBA_STRIPPED = /^([A-Z]{2,5})(Z[CG])(\d{3,4})(T?)$/;

export function normalizeDibbaCourseCode(input: string): string {
  if (typeof input !== 'string') {
    throw new Error(
      'Not a valid Dibba course code: input must be a string. ' +
        'Expected like "SS ZG628T" or "POWAB ZC113" (2-5 letter discipline, Z[CG], 3-4 digits, optional T).',
    );
  }
  const stripped = input.toUpperCase().replace(/\s+/g, '');
  const m = stripped.match(DIBBA_STRIPPED);
  if (!m) {
    throw new Error(
      `Not a valid Dibba course code: "${input}". ` +
        'Expected like "SS ZG628T" or "POWAB ZC113" (2-5 letter discipline, Z[CG], 3-4 digits, optional T).',
    );
  }
  return `${m[1]} ${m[2]}${m[3]}${m[4]}`;
}

/**
 * Find every course code embedded in free text — a Dibba cell holds 0-8 of
 * them, interleaved with titles, ERP ids (`1. 504303|IS ZC364|...`), pipes and
 * notes. Port of the prototype's CODE_RE: tolerates joined (`ENGGZC232`),
 * extra-spaced (`MBA    ZG527`) and split-digit (`EEE ZG 571`) forms. Returns
 * canonical codes with their `[start, end)` offsets in the ORIGINAL text, in
 * document order, so callers can slice the title that follows each code.
 */
const DIBBA_SCAN = /\b([A-Z]{2,5})\s*(Z\s*[CG])\s*(\d)\s*(\d)\s*(\d)(\d?)(T?)\b/g;

export interface FoundCourseCode {
  code: string;
  start: number;
  end: number;
}

export function findDibbaCourseCodes(text: string): FoundCourseCode[] {
  const out: FoundCourseCode[] = [];
  // Length-preserving uppercase (ASCII letters only) so the offsets index the
  // ORIGINAL text — String#toUpperCase can change length for some non-ASCII chars.
  const upper = text.replace(/[a-z]/g, (ch) => ch.toUpperCase());
  for (const m of upper.matchAll(DIBBA_SCAN)) {
    const prefix = m[1] ?? '';
    const zc = (m[2] ?? '').replace(/\s+/g, '');
    const digits = `${m[3] ?? ''}${m[4] ?? ''}${m[5] ?? ''}${m[6] ?? ''}`;
    const t = m[7] ?? '';
    const start = m.index ?? 0;
    out.push({ code: `${prefix} ${zc}${digits}${t}`, start, end: start + m[0].length });
  }
  return out;
}

/**
 * Zod schema that validates an ALREADY-canonical BITS course number. Use this
 * AFTER `normalizeBitsCourseNumber()` — it is the strict post-normalization
 * gate (the array elements stored in `Course.alternateCodes` go through here).
 */
export const bitsCourseNumberSchema = z
  .string()
  .regex(
    CANONICAL,
    'Must be like "AE ZG631" — 2-4 letter discipline, one space, Z[CG], 3-4 digits.',
  );

/**
 * Extract the discipline prefix from a course's canonical BITS number.
 *
 * Single source of truth (Prompt 11b decision): no stored `discipline` column,
 * derived at the call site. Trivially testable; no sync logic to maintain.
 * If discipline-grouped queries ever become hot, this can be promoted to a
 * stored column with a derivation trigger in a later PR.
 */
export function getDiscipline(course: { bitsCourseNumber: string }): string {
  const prefix = course.bitsCourseNumber.split(' ')[0];
  if (!prefix) {
    throw new Error(
      `Course.bitsCourseNumber is malformed: "${course.bitsCourseNumber}". ` +
        'Cannot derive discipline. Did this row bypass normalizeBitsCourseNumber()?',
    );
  }
  return prefix;
}

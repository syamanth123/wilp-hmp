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

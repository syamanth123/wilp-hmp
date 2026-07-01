/**
 * Display-ordinal derivation for the Part A coded lists.
 *
 * CO / Text Book / Reference / LO codes (CO1, T1, R1, LO1, …) are DERIVED FROM
 * ARRAY POSITION at render time, not read from the stored `code`. This is the
 * single source of truth shared by the HTML renderer (`renderBitsHandout`) and
 * the Word export (`build-docx`) — so a reordered list reads identically in
 * both (CO1, CO2, CO3 everywhere; never CO2, CO1, CO3 in one and CO1, CO2, CO3
 * in the other).
 *
 * Only these four fields are ordinal-coded: their schema `code` is a strict
 * `^(CO|T|R|LO)\d+$` regex — a pure positional ordinal. `sessionNumber`,
 * `experimentNumber`, and `ecNumber` are free-form `z.string()` (ranges like
 * "5-6", trailing dots like "6.", "EC-1") and are left author-entered.
 *
 * The stored `code` is retained (still schema-required, regex validates FORMAT
 * not position, so reordered handouts still parse) but is no longer read for
 * display; the editor's auto-numbering (editor-quality PR) removes manual code
 * entry.
 */

export type OrdinalPrefix = 'CO' | 'T' | 'R' | 'LO';

/** Derive the display code for the `index`-th row of an ordinal-coded list. */
export function ordinalCode(prefix: OrdinalPrefix, index: number): string {
  return `${prefix}${index + 1}`;
}

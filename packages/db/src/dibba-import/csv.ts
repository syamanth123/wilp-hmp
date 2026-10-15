/**
 * Minimal RFC-4180 CSV reader for the faculty → course sheet uploaded as CSV
 * (Course Dibba Phase 4, plan D6). Handles quoted fields with embedded commas,
 * doubled quotes ("") and newlines, CRLF or LF line ends and a UTF-8 BOM. The
 * first row is the header (cells trimmed); blank lines are skipped; short rows
 * are padded with ''. Pure, no dependency — the repo has no CSV library and
 * this is the only CSV input.
 */

/** Rows as arrays of cells, header row included. */
export function parseCsvRows(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      quoted = true;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      continue;
    }
    if (c === '\r') continue; // CRLF: the following \n ends the row
    if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }
    field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Records keyed by the (trimmed) header cells; blank lines skipped. */
export function parseCsv(text: string): Array<Record<string, string>> {
  const rows = parseCsvRows(text);
  if (rows.length === 0) return [];
  const headers = rows[0]!.map((h) => h.trim());
  const out: Array<Record<string, string>> = [];
  for (const row of rows.slice(1)) {
    if (row.every((cell) => cell.trim() === '')) continue;
    const rec: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (h) rec[h] = row[i] ?? '';
    });
    out.push(rec);
  }
  return out;
}

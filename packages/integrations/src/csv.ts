/**
 * Minimal RFC 4180-ish CSV parser.
 * - Handles quoted fields with embedded quotes ("") and commas.
 * - Trims a UTF-8 BOM if present.
 * - Skips blank lines and lines beginning with '#'.
 */
export function parseCsv(input: string): { header: string[]; rows: Record<string, string>[] } {
  const text = input.replace(/^\uFEFF/, '');
  const records: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    records.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      pushField();
      i += 1;
      continue;
    }
    if (ch === '\r') {
      i += 1;
      continue;
    }
    if (ch === '\n') {
      pushField();
      pushRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field.length > 0 || row.length > 0) {
    pushField();
    pushRow();
  }

  const filtered = records.filter((r) => {
    if (r.length === 0) return false;
    const first = r[0] ?? '';
    if (r.length === 1 && first.trim() === '') return false;
    if (first.trimStart().startsWith('#')) return false;
    return true;
  });

  if (filtered.length === 0) return { header: [], rows: [] };

  const header = (filtered[0] ?? []).map((h) => h.trim());
  const rows = filtered.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    header.forEach((h, idx) => {
      obj[h] = (r[idx] ?? '').trim();
    });
    return obj;
  });

  return { header, rows };
}

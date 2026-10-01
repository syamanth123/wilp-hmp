import mammoth from 'mammoth';
import { findDibbaCourseCodes } from '../course-code';
import { standardSlotNo, type SlotDay, type SlotSession } from '../dibba-slots';
import type { DibbaCourseType, DibbaParseResult, DibbaRow } from './types';

/**
 * Course Dibba Word parser (Phase 2) — a pure function: .docx bytes/path in,
 * rows + warnings out. No I/O beyond reading the input, no Prisma. Server-only
 * (mammoth) — import via `@hmp/db/src/dibba-import`, never from the barrel.
 *
 * Port of docs/course-dibba/parse_dibba.py (the starter-kit prototype), whose
 * rules were proven on the real 2025 file (1,077 rows / 638 codes / 41
 * programmes / 3 header warnings); the spec is docs/course-dibba-schedule.md §5.
 * The one deliberate difference from both the prototype and corpus-import's
 * table walker: this one honors `colspan` / `rowspan`. The Dibba's programme
 * title rows are merged across the whole table and a batch cell can span
 * several rows, so cells are placed on a grid first; a cell that spans slot
 * columns is assigned to its FIRST column and flagged, never silently shifted.
 */

export type ParseDibbaInput = { path: string } | { buffer: Buffer };

export async function parseDibbaDocx(input: ParseDibbaInput): Promise<DibbaParseResult> {
  const result =
    'path' in input
      ? await mammoth.convertToHtml({ path: input.path })
      : await mammoth.convertToHtml({ buffer: input.buffer });
  return parseDibbaHtml(result.value);
}

// ---------------------------------------------------------------------------
// HTML → grid (exported for unit tests with hand-written HTML)
// ---------------------------------------------------------------------------

interface GridCell {
  /** Unique per PHYSICAL cell; continuation positions of a merged cell share it. */
  id: number;
  text: string;
}

/** A table as a rectangular grid: rows × columns, merges expanded in place. */
export type TableGrid = GridCell[][];

/**
 * Walk mammoth's `<table>` HTML and expand merged cells onto a grid. A cell
 * with `colspan=N` occupies N consecutive columns of its row; `rowspan=M`
 * occupies the same column(s) in the next M-1 rows (so a batch cell merged
 * down the table is present on every row it covers, exactly as python-docx
 * reports it). Nested tables are not expected (corpus-import has the same
 * assumption); one is reported as a warning, not silently flattened.
 */
export function htmlTablesToGrids(html: string): { grids: TableGrid[]; warnings: string[] } {
  const grids: TableGrid[] = [];
  const warnings: string[] = [];
  let nextId = 1;
  // Top-level tables only (= python-docx's `doc.tables`): a nested table is cut
  // out of its parent cell and reported, so the ENCLOSING table keeps every row
  // and the table numbering carried in warning text stays aligned with the prototype.
  splitTopLevelTables(html).forEach(({ inner, nested }, tableIndex) => {
    if (nested) {
      warnings.push(`table ${tableIndex}: nested table detected — its cells were ignored`);
    }
    let overlapWarned = false;
    const grid: TableGrid = [];
    // pending[r][c] = cell carried down from an earlier row by rowspan
    const pending = new Map<number, Map<number, GridCell>>();
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rm: RegExpExecArray | null;
    let r = 0;
    while ((rm = rowRegex.exec(inner)) !== null) {
      const row: GridCell[] = [];
      const carried = pending.get(r) ?? new Map<number, GridCell>();
      const cellRegex = /<t([dh])\b([^>]*)>([\s\S]*?)<\/t\1>/gi;
      let cm: RegExpExecArray | null;
      let c = 0;
      const place = (col: number, cell: GridCell): void => {
        // Word cannot produce overlapping merges, so this only fires on malformed
        // HTML; report once per table instead of silently dropping a cell.
        if (row[col] !== undefined && row[col]!.id !== cell.id && !overlapWarned) {
          overlapWarned = true;
          warnings.push(
            `table ${tableIndex}: overlapping merged cells at row ${r}, column ${col} — later cells may be shifted`,
          );
        }
        row[col] = cell;
      };
      while ((cm = cellRegex.exec(rm[1] ?? '')) !== null) {
        // advance past columns already occupied by a rowspan from above
        while (carried.has(c)) {
          place(c, carried.get(c)!);
          c += 1;
        }
        const attrs = cm[2] ?? '';
        const colspan = Math.max(1, parseInt(/colspan\s*=\s*"?(\d+)/i.exec(attrs)?.[1] ?? '1', 10));
        const rowspan = Math.max(1, parseInt(/rowspan\s*=\s*"?(\d+)/i.exec(attrs)?.[1] ?? '1', 10));
        const cell: GridCell = { id: nextId++, text: cellText(cm[3] ?? '') };
        for (let k = 0; k < colspan; k += 1) {
          place(c + k, cell);
          for (let dr = 1; dr < rowspan; dr += 1) {
            const target = pending.get(r + dr) ?? new Map<number, GridCell>();
            target.set(c + k, cell);
            pending.set(r + dr, target);
          }
        }
        c += colspan;
      }
      // trailing carried cells with no explicit cell after them
      for (const [col, cell] of carried) if (!row[col]) place(col, cell);
      // fill any holes so the row is dense
      for (let i = 0; i < row.length; i += 1) if (!row[i]) row[i] = { id: nextId++, text: '' };
      if (row.length > 0) grid.push(row);
      r += 1;
    }
    grids.push(grid);
  });
  return { grids, warnings };
}

/**
 * Balanced scan for top-level `<table>` elements. Content at nesting depth 1
 * belongs to the top-level table; anything deeper (a nested table) is dropped
 * and flagged, matching python-docx where `doc.tables` never sees nested ones.
 */
function splitTopLevelTables(html: string): Array<{ inner: string; nested: boolean }> {
  const out: Array<{ inner: string; nested: boolean }> = [];
  const token = /<table\b[^>]*>|<\/table\s*>/gi;
  let depth = 0;
  let parts: string[] = [];
  let nested = false;
  let cursor = 0;
  let t: RegExpExecArray | null;
  while ((t = token.exec(html)) !== null) {
    if (depth === 1) parts.push(html.slice(cursor, t.index));
    if (t[0][1] !== '/') {
      depth += 1;
      if (depth === 1) {
        parts = [];
        nested = false;
      } else nested = true;
    } else if (depth > 0) {
      depth -= 1;
      if (depth === 0) out.push({ inner: parts.join(''), nested });
    }
    cursor = t.index + t[0].length;
  }
  return out;
}

/**
 * Cell text with paragraph boundaries preserved as "\n" — mammoth renders each
 * Word paragraph in a cell as `<p>…</p>` and in-paragraph breaks as `<br>`.
 * The prototype's batch rule ("a number alone on its own line") depends on
 * this, so it is kept rather than collapsed to spaces (which is what
 * corpus-import does for its own needs).
 */
function cellText(innerHtml: string): string {
  // EVERY block-level boundary becomes "\n": mammoth's default style map turns
  // heading-styled paragraphs into <h1>-<h6>, and a fused line would silently
  // blank the "number alone on its own line" student count (review finding).
  // Inline tags (<strong>, <em>, <a>…) are removed without a separator so a
  // bold run inside a word cannot split it.
  const withBreaks = innerHtml
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|h[1-6]|li|div|blockquote|pre|dd|dt|tr|td|th)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '');
  return decodeEntities(withBreaks)
    .split('\n')
    .map((l) => l.replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter((l, i, arr) => !(l === '' && (i === 0 || i === arr.length - 1 || arr[i - 1] === '')))
    .join('\n')
    .trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)));
}

/** Collapse a grid row to its distinct physical cells, in order (= python-docx's de-duplicated `row.cells`). */
function distinctCells(row: GridCell[]): GridCell[] {
  const out: GridCell[] = [];
  for (const cell of row) if (out[out.length - 1]?.id !== cell.id) out.push(cell);
  return out;
}

// ---------------------------------------------------------------------------
// Rules (ported from parse_dibba.py — keep in step with it)
// ---------------------------------------------------------------------------

const DAYS: ReadonlySet<string> = new Set(['SAT', 'SUN', 'FRI']);
const SESSIONS: Readonly<Record<string, SlotSession>> = { FN: 'FN', AN: 'AN', EV: 'EV', EN: 'EV' };

interface SlotHeader {
  slotNo: number;
  day: SlotDay | null;
  session: SlotSession | null;
  warning: string | null;
}

/** "SL7(SAT EV)", "SAT EN", "SL8 (SUN (EN))" → slot number + day/session, with the spec §5.3 warnings. */
export function parseSlotHeader(header: string, columnIndex: number): SlotHeader {
  const t = header.toUpperCase().replace(/[()]/g, ' ');
  const sl = /SL\s*(\d)/.exec(t);
  const words = t.match(/[A-Z]+/g) ?? [];
  const day = (words.find((w) => DAYS.has(w)) ?? null) as SlotDay | null;
  const sesWord = words.find((w) => w in SESSIONS);
  const session = sesWord ? SESSIONS[sesWord]! : null;
  const standard = day && session ? standardSlotNo(day, session) : undefined;
  let slotNo = sl ? parseInt(sl[1] ?? '0', 10) : standard;
  let warning: string | null = null;
  if (slotNo === undefined) {
    slotNo = columnIndex; // last resort: column position (column 1 == SL1)
    warning = `slot inferred from column position for header "${header.trim()}"`;
  } else if (sl && standard !== undefined && standard !== slotNo) {
    warning = `header "${header.trim()}" disagrees with standard slot map (SL${slotNo} vs ${day} ${session})`;
  }
  return { slotNo, day, session, warning };
}

const BATCH_RE = /([12])\s*\/\s*(20\d\d)/;
const ERP_TERM_CODE = /^5[01]\d\d$/; // "(5092)", "(5105)" are ERP term codes, not head-counts

interface BatchCell {
  admitBatch: string | null;
  isNewAdmission: boolean;
  isBacklogRow: boolean;
  studentCount: number | null;
}

/** "2/2024 \n (178)" → 2/2024 + 178; "2/2020 (5092) (3rdSem) 3 core + EL (00)" → 2/2020 + 0; "2/2024\n502" → 502. */
export function parseBatchCell(text: string): BatchCell {
  const m = BATCH_RE.exec(text);
  // Blank EVERY batch token before hunting for the head-count (the prototype's
  // re.sub is replace-all) — a second, line-split token must not leak its year.
  const rest = text.replace(/([12])\s*\/\s*(20\d\d)/g, ' ');
  const bracketed = [...rest.matchAll(/\((\d{1,4})\)/g)]
    .map((x) => x[1] ?? '')
    .filter((n) => !ERP_TERM_CODE.test(n));
  const bare = [...rest.matchAll(/^\s*(\d{1,4})\s*$/gm)]
    .map((x) => x[1] ?? '')
    .filter((n) => !ERP_TERM_CODE.test(n));
  const pick = bracketed.length > 0 ? bracketed : bare;
  const last = pick[pick.length - 1];
  return {
    admitBatch: m ? `${m[1]}/${m[2]}` : null,
    isNewAdmission: /NEW ADM/i.test(text),
    isBacklogRow: /BACKLOG/i.test(text),
    studentCount: last !== undefined ? parseInt(last, 10) : null,
  };
}

const PROG_RE =
  /^\s*((?:[A-Z]{2}\s?\d{2}|\d{2}[A-Z]{2})(?:\s*\/\s*(?:[A-Z]{2}\s?\d{2}|\d{2}[A-Z]{2}))*)/;

/** "HB28 MBA (…)" → "HB28"; "18BT/18ET B.Tech." → "18BT/18ET"; "HT 31 M.Tech." → "HT31". */
export function programmeCodeOf(title: string): string {
  const m = PROG_RE.exec(title.toUpperCase());
  return m ? (m[1] ?? '').replace(/\s+/g, '') : '';
}

function classify(fragment: string, code: string): DibbaCourseType {
  const u = fragment.toUpperCase();
  if (u.includes('NOT OFFERED')) return 'NOT_OFFERED';
  if (u.includes('BACKLOG') || u.includes('BKLG')) return 'BACKLOG';
  if (code.endsWith('T')) return 'PROJECT'; // spec §5.5: dissertation / project codes
  if (u.includes('CORE')) return 'CORE';
  return 'UNSPECIFIED';
}

const TIME_RE = /\b(SAT(?:URDAY)?|SUN(?:DAY)?|FRI(?:DAY)?)\s*(\d{1,2})[.:](\d{2})/i;
const ERP_PREFIX_RE = /(\d{6})\s*\|\s*$/;

// ---------------------------------------------------------------------------
// Document walk
// ---------------------------------------------------------------------------

/** Parse mammoth HTML (already converted). Exported so merged-cell alignment can be unit-tested without a Word file. */
export function parseDibbaHtml(html: string): DibbaParseResult {
  const { grids, warnings } = htmlTablesToGrids(html);
  const rows: DibbaRow[] = [];
  let programme = '';

  grids.forEach((grid, ti) => {
    // Rows are consumed only after an "Admit Batch" header row is seen in THIS
    // table. Table 0 of the 2025 file holds the index AND the first programme.
    let header: Array<SlotHeader | undefined> | null = null;
    let headerFirstWidth = 1; // grid width of the "Admit Batch" label cell

    for (const gridRow of grid) {
      const cells = distinctCells(gridRow);
      const texts = cells.map((c) => c.text);
      const first = texts[0] ?? '';
      const isHeader = first.trim().toLowerCase().startsWith('admit');

      if (texts.length === 1 || (!header && !isHeader)) {
        if (first.trim()) programme = first.replace(/\s+/g, ' ').trim();
        continue;
      }
      if (isHeader) {
        // Parse each PHYSICAL header cell once, indexed by its position among
        // the distinct cells (exactly the prototype's enumerate(texts), which
        // also drives the column-position fallback), then fan the result out to
        // every grid column it spans so data cells align by column. The
        // column-0 run (the "Admit Batch" label) maps to undefined.
        const hdr = new Array<SlotHeader | undefined>(gridRow.length).fill(undefined);
        let c = 0;
        let di = 0;
        while (c < gridRow.length) {
          const cell = gridRow[c]!;
          let w = 1;
          while (gridRow[c + w]?.id === cell.id) w += 1;
          if (di === 0) {
            headerFirstWidth = w;
          } else {
            const h = parseSlotHeader(cell.text, di);
            if (h.warning) warnings.push(`table ${ti} ${programme.slice(0, 40)}: ${h.warning}`);
            for (let k = 0; k < w; k += 1) hdr[c + k] = h;
          }
          c += w;
          di += 1;
        }
        header = hdr;
        continue;
      }
      if (!header) continue;

      const batch = parseBatchCell(first);
      const firstId = gridRow[0]?.id;
      let col = 0;
      while (col < gridRow.length) {
        const cell = gridRow[col]!;
        // width of this physical cell on the grid
        let span = 1;
        while (gridRow[col + span]?.id === cell.id) span += 1;
        if (col === 0 || cell.id === firstId) {
          // A batch cell wider than the header's label cell is the one case where
          // python-docx's de-duplicated cells shift later slots left; the grid
          // keeps true columns, so say so — a slot-only golden diff then explains itself.
          if (col === 0 && span !== headerFirstWidth) {
            warnings.push(
              `table ${ti} ${programme.slice(0, 30)} batch ${batch.admitBatch ?? ''}: batch cell spans ${span} columns (header label spans ${headerFirstWidth}) — later cells keep their true slot`,
            );
          }
          col += span;
          continue;
        }
        const h = header[col];
        const text = cell.text;
        if (!h || !text.trim()) {
          col += span;
          continue;
        }
        if (span > 1) {
          warnings.push(
            `table ${ti} ${programme.slice(0, 30)} batch ${batch.admitBatch ?? ''}: cell spans ${span} slot columns (SL${h.slotNo}..), assigned to SL${h.slotNo}`,
          );
        }
        const codes = findDibbaCourseCodes(text);
        if (codes.length === 0) {
          // Prototype text exactly (empty batch renders as "batch  SL…").
          warnings.push(
            `table ${ti} ${programme.slice(0, 30)} batch ${batch.admitBatch ?? ''} SL${h.slotNo}: no course code in '${text.trim().slice(0, 60)}'`,
          );
        }
        codes.forEach((found, k) => {
          const next = codes[k + 1]?.start ?? text.length;
          const fragment = text.slice(found.start, next);
          const titleRaw =
            text
              .slice(found.end, next)
              .replace(/^[\s|:]+/, '')
              .split('\n')[0] ?? '';
          const title = stripEnds(titleRaw.replace(/\(.*$/, '').trim(), ' /|:');
          const tm = TIME_RE.exec(fragment);
          const erp = ERP_PREFIX_RE.exec(text.slice(0, found.start));
          rows.push({
            programmeCode: programmeCodeOf(programme),
            programmeTitle: programme,
            admitBatch: batch.admitBatch,
            isNewAdmission: batch.isNewAdmission,
            isBacklogRow: batch.isBacklogRow,
            studentCount: batch.studentCount,
            slotNo: h.slotNo,
            slotDay: h.day,
            slotSession: h.session,
            courseCode: found.code,
            courseTitle: title,
            courseType: classify(fragment, found.code),
            erpCourseId: erp?.[1] ?? null,
            classTimeHint: tm
              ? `${(tm[1] ?? '').slice(0, 3).toUpperCase()} ${tm[2]}:${tm[3]}`
              : null,
            remarks: null,
            rawCell: fragment.replace(/\s+/g, ' ').trim().slice(0, 120),
          });
        });
        col += span;
      }
    }
  });

  return { rows, warnings, tableCount: grids.length };
}

/** Python's str.strip(chars): remove any of `chars` from both ends. */
function stripEnds(s: string, chars: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && chars.includes(s[start]!)) start += 1;
  while (end > start && chars.includes(s[end - 1]!)) end -= 1;
  return s.slice(start, end);
}

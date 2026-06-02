import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import mammoth from 'mammoth';
import { BitsHandoutSchemaV1, type BitsHandoutV1 } from '../handout-schema';
import { normalizeBitsCourseNumber } from '../course-code';

/**
 * Corpus parser (Prompt 11f-a). Converts a single BITS WILP `.docx` handout
 * into a structured `BitsHandoutV1` via a three-tier extraction strategy:
 *
 *   Tier 1 — mammoth-structured: convert .docx → HTML (mammoth preserves
 *     tables and joins runs), parse the HTML into a paragraph/table tree,
 *     walk the tree extracting Part A / CO / LO / T / R / Part B /
 *     Evaluation rows. The standard CO/LO template path.
 *
 *   Tier 2 — text-fallback: when Tier 1's structural extraction fails (e.g.,
 *     tables-malformed for mammoth to extract cleanly), fall back to
 *     `mammoth.extractRawText` + regex matching. Same approach as the 11a
 *     proxy parser, kept for resilience.
 *
 *   Tier 3 — skip with diagnostic: parser returns `data: null` plus a
 *     specific `parseErrors` entry naming what was missing. The
 *     `extractionMethod` field records which path was taken so the admin
 *     UI can filter and re-parse.
 *
 * Pre-flight skips:
 *   - Files >maxBytes (default 3 MB) → `SKIPPED_SIZE`. Image-heavy handouts
 *     bloat past the cap; that's 11a's precedent.
 *   - Non-.docx files (.doc legacy binary, .pdf) → `SKIPPED_FORMAT`. Mammoth
 *     can't read either; libreoffice conversion is out of scope for 11f-a.
 *
 * Early-return skips:
 *   - Files with a "Course Modules" cell anywhere in their structure use the
 *     EE-style Module template. Their per-module Objectives don't map cleanly
 *     to `partA.courseObjectives[{code, description}]`, so 11f-a returns
 *     `SKIPPED_MODULE` with a parseWarning naming 11f-b as the follow-up.
 *
 * Synonym handling:
 *   - `Experiential Learning` ≡ `Laboratory` (real synonyms; both indicate
 *     the experiential section).
 *   - `Modular Content` is NOT a synonym — survey finding for 11f-a (audit
 *     §5 corrects an earlier claim). Parser drops Modular Content content
 *     with a `parseWarnings` entry.
 *
 * HHSM value-swap: in some handouts (notably the HHSM family) the Part A
 * header table has the values for `Course Title` and `Course No(s)` reversed
 * while the labels stay in the correct cell positions. Parser validates the
 * Course No(s) value via `normalizeBitsCourseNumber()`; if validation fails
 * AND the Course Title cell normalizes successfully, swap them.
 */

/** Mirrors the Prisma `CorpusExtractionMethod` enum. Kept in sync by hand. */
export type CorpusExtractionMethod =
  | 'MAMMOTH_STRUCTURED'
  | 'TEXT_FALLBACK'
  | 'FAILED'
  | 'SKIPPED_MODULE'
  | 'SKIPPED_SIZE'
  | 'SKIPPED_FORMAT'
  | 'SKIPPED_NARRATIVE_PROSE';

export interface ParseInput {
  filePath: string;
  fileBytes: number;
  /** Default 3 MB, per the 11a precedent. Override for tests. */
  maxBytes?: number;
}

export interface ParseResult {
  data: BitsHandoutV1 | null;
  warnings: string[];
  errors: string[];
  bitsCourseNumber: string | null;
  alternateCodes: string[];
  extractionMethod: CorpusExtractionMethod;
}

const DEFAULT_MAX_BYTES = 3 * 1024 * 1024;

export async function parseDocxToHandout(input: ParseInput): Promise<ParseResult> {
  // ---- Pre-flight: format check ----
  const lower = input.filePath.toLowerCase();
  if (!lower.endsWith('.docx')) {
    return {
      data: null,
      warnings: [],
      errors: [`Unsupported format: ${basename(input.filePath)}. Only .docx is parsed by 11f-a.`],
      bitsCourseNumber: null,
      alternateCodes: [],
      extractionMethod: 'SKIPPED_FORMAT',
    };
  }

  // ---- Pre-flight: size cap ----
  const limit = input.maxBytes ?? DEFAULT_MAX_BYTES;
  if (input.fileBytes > limit) {
    return {
      data: null,
      warnings: [],
      errors: [
        `File size ${input.fileBytes.toLocaleString()} bytes exceeds ${limit.toLocaleString()}-byte cap; ` +
          `skipped as image-heavy outlier (11a precedent).`,
      ],
      bitsCourseNumber: null,
      alternateCodes: [],
      extractionMethod: 'SKIPPED_SIZE',
    };
  }

  // ---- Tier 1: mammoth → HTML ----
  let html: string;
  try {
    const result = await mammoth.convertToHtml({ path: input.filePath });
    html = result.value;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      data: null,
      warnings: [],
      errors: [`Mammoth conversion failed: ${msg}`],
      bitsCourseNumber: null,
      alternateCodes: [],
      extractionMethod: 'FAILED',
    };
  }

  const tree = parseHtmlToTree(html);

  // ---- Early-return: Module template ----
  if (detectModuleTemplate(tree)) {
    const probe = bestEffortCourseNumber(tree);
    const filenameProbe = courseNumberFromFilename(input.filePath);
    return {
      data: null,
      warnings: [
        'Course Modules template detected — per-module Objectives do not map to ' +
          'partA.courseObjectives in BitsHandoutSchemaV1. Will be addressed in Prompt 11f-b.',
      ],
      errors: [],
      bitsCourseNumber: probe.bitsCourseNumber ?? filenameProbe,
      alternateCodes: probe.alternateCodes,
      extractionMethod: 'SKIPPED_MODULE',
    };
  }

  // ---- Tier 1: structured extraction ----
  const t1 = extractStructured(tree);
  if (t1.data) {
    return { ...t1, extractionMethod: 'MAMMOTH_STRUCTURED' };
  }

  // ---- Early-return: narrative-prose template (11f-b1) ----
  // If Tier 1 failed AND the document has the colon-prose Part A signature,
  // it's the narrative-prose template (Survey B finding, 5 corpus files).
  // Mapping is parser-design work for a future prompt; for now, return
  // SKIPPED_NARRATIVE_PROSE with a course-number best-effort.
  if (detectNarrativeProse(tree)) {
    const filenameProbe = courseNumberFromFilename(input.filePath);
    let proseProbe: string | null = null;
    let proseAlts: string[] = [];
    for (const node of tree) {
      if (node.kind !== 'paragraph') continue;
      const m = node.text.match(/^course no\.?\s*:\s*(.+?)$/i);
      if (m && m[1]) {
        proseProbe = tryNormalize(m[1].trim());
        proseAlts = parseAlternateCodes(m[1].trim());
        break;
      }
    }
    return {
      data: null,
      warnings: [
        'Narrative-prose template detected — Part A as colon-separated lines, ' +
          'text books as un-tabled prose. Different parser path needed; ' +
          'addressed in a future prompt.',
      ],
      errors: [],
      bitsCourseNumber: proseProbe ?? filenameProbe,
      alternateCodes: proseAlts,
      extractionMethod: 'SKIPPED_NARRATIVE_PROSE',
    };
  }

  // ---- Tier 2: text-fallback ----
  // Run only if Tier 1 didn't produce data. Tier 2 errors join Tier 1's.
  const rawText = await safeExtractRawText(input.filePath);
  const t2 = extractFromText(rawText);
  if (t2.data) {
    return {
      ...t2,
      warnings: [...t1.warnings, ...t2.warnings],
      errors: [], // Tier 2 succeeded; Tier 1 errors are informational only
      extractionMethod: 'TEXT_FALLBACK',
    };
  }

  // ---- Tier 3: failed ----
  return {
    data: null,
    warnings: [...t1.warnings, ...t2.warnings],
    errors: [...t1.errors, ...t2.errors, 'Both structured and text-fallback extraction failed.'],
    bitsCourseNumber: t1.bitsCourseNumber ?? t2.bitsCourseNumber,
    alternateCodes: t1.alternateCodes.length ? t1.alternateCodes : t2.alternateCodes,
    extractionMethod: 'FAILED',
  };
}

// ============================================================================
// HTML tree parsing — minimal, regex-driven
// ============================================================================

interface PNode {
  kind: 'paragraph';
  text: string;
}

interface TNode {
  kind: 'table';
  /** Rows of cell texts; cells already have leading/trailing whitespace trimmed. */
  rows: string[][];
}

type Node = PNode | TNode;

/**
 * Parse mammoth's HTML output into a flat list of paragraph + table nodes.
 * Mammoth's structure: `<p>text</p>` for paragraphs, `<table><tr><td><p>cell
 * text</p></td>...</tr>...</table>` for tables. We extract text content per
 * cell (joining nested `<p>` paragraphs within a cell with spaces).
 */
export function parseHtmlToTree(html: string): Node[] {
  const nodes: Node[] = [];
  // Split top-level into alternating <table>...</table> and everything else.
  // Mammoth doesn't nest tables in our corpus (verified manually on fixtures
  // and on AEL ZG631 / EE family / HHSM); a simple regex split is sufficient.
  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = tableRegex.exec(html)) !== null) {
    const before = html.slice(lastIdx, m.index);
    nodes.push(...parseParagraphs(before));
    nodes.push({ kind: 'table', rows: parseTableRows(m[1]!) });
    lastIdx = m.index + m[0].length;
  }
  nodes.push(...parseParagraphs(html.slice(lastIdx)));
  return nodes;
}

function parseParagraphs(html: string): PNode[] {
  const out: PNode[] = [];
  const paraRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let m: RegExpExecArray | null;
  while ((m = paraRegex.exec(html)) !== null) {
    const text = stripTagsAndDecode(m[1]!).trim();
    if (text.length > 0) out.push({ kind: 'paragraph', text });
  }
  return out;
}

function parseTableRows(tableHtml: string): string[][] {
  const rows: string[][] = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRegex.exec(tableHtml)) !== null) {
    const cells: string[] = [];
    const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cm: RegExpExecArray | null;
    while ((cm = cellRegex.exec(m[1]!)) !== null) {
      cells.push(stripTagsAndDecodeWithBullets(cm[1]!).trim());
    }
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

/**
 * 11f-b1: cell-text extraction that preserves `<li>` boundaries as `"; "`
 * separators. Real-corpus Part B sub-topic cells are rendered by mammoth as
 * `<ul><li>X</li><li>Y</li></ul>`; the original stripTagsAndDecode would
 * produce `"XY"` (no separator), losing the bullet structure. Inserting
 * `"; "` between bullets keeps the schema's join contract ("; " is the
 * canonical sub-topic separator, audit §5).
 */
function stripTagsAndDecodeWithBullets(html: string): string {
  return html
    .replace(/<\/li\s*>/gi, '; ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/;\s*$/, '')
    .replace(/\s+/g, ' ');
}

function stripTagsAndDecode(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ');
}

// ============================================================================
// Template detection
// ============================================================================

function detectModuleTemplate(tree: Node[]): boolean {
  // Heuristic: the EE-style template carries a "Course Modules" cell or
  // standalone paragraph followed by a table whose first row matches
  // "Module No | Module Title | Objectives". We accept either signal as
  // sufficient — the false-positive risk is low (standard templates use
  // "Course Objectives", not "Course Modules").
  //
  // 11f-b1 relaxation: match "Course Modules" anywhere in a paragraph's
  // trimmed text, not just `/^course modules$/i`. EE_ZG513 in the real
  // corpus had whitespace/formatting that produced a paragraph the strict
  // regex missed — the relaxed match catches it without introducing
  // false-positives (no standard-template file uses "Course Modules" as a
  // section label).
  for (const node of tree) {
    if (node.kind === 'paragraph' && /\bcourse modules\b/i.test(node.text)) return true;
    if (node.kind === 'table') {
      for (const row of node.rows) {
        if (row.some((c) => /\bcourse modules\b/i.test(c))) return true;
        // Also catch the "Module No | Module Title | Objectives" header row
        if (
          row.length >= 3 &&
          /^module no\.?$/i.test(row[0]!) &&
          /^module title$/i.test(row[1]!) &&
          /^objectives?$/i.test(row[2]!)
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * 11f-b1 — detect the narrative-prose template (Survey B finding). Five
 * corpus files (EE ZG613/623, POM ZG512/522, ST ZG612) use a layout where
 * Part A is rendered as colon-separated prose lines rather than a labeled
 * header table:
 *
 *   Course No. : EE ZG613
 *   Course Title : Environmental Systems Modelling
 *   Instructor in charge : Murari R R Varma
 *
 * with text books and reference books as un-tabled prose lists. The shape
 * is too different from the standard CO/LO template for the current parser
 * to recover; we return SKIPPED_NARRATIVE_PROSE with a diagnostic.
 *
 * Detection signal: text body contains the prose pattern AND no Part A
 * header table was found (the caller has already established the latter).
 */
function detectNarrativeProse(tree: Node[]): boolean {
  for (const node of tree) {
    if (node.kind !== 'paragraph') continue;
    if (/^course no\.?\s*:\s*[A-Z]{2,4}\s*Z[CG]\d{3,4}\b/i.test(node.text)) return true;
  }
  return false;
}

function bestEffortCourseNumber(tree: Node[]): {
  bitsCourseNumber: string | null;
  alternateCodes: string[];
} {
  // Same logic as Part A header extraction but tolerant of missing fields —
  // used for the SKIPPED_MODULE diagnostic so admins can still filter.
  for (const node of tree) {
    if (node.kind !== 'table') continue;
    for (const row of node.rows) {
      if (row.length >= 2 && /^course no\(?s?\)?\.?$/i.test(row[0]!)) {
        const cand = row[1]!;
        try {
          const canonical = normalizeBitsCourseNumber(cand);
          return { bitsCourseNumber: canonical, alternateCodes: parseAlternateCodes(cand) };
        } catch {
          // Fall through — bestEffort is allowed to give up.
        }
      }
    }
  }
  return { bitsCourseNumber: null, alternateCodes: [] };
}

/**
 * Last-resort fallback: extract a course number from the source filename.
 * BITS corpus convention is `<COURSE> COURSE HANDOUT[ REVISED].docx`. Used
 * for SKIPPED_MODULE rows where the in-document extraction often misses
 * because the Module template doesn't have a "Course No(s)" label cell.
 */
function courseNumberFromFilename(filePath: string): string | null {
  const name = basename(filePath).replace(/\.docx$/i, '');
  // Tolerant prefix match. The normalizer handles the canonical-form
  // collapse, so we just need to find SOMETHING starting with [A-Z]{2,4}
  // followed by Z[CG] then 3-4 digits. Corpus has filename irregularities
  // like `EE ZG521COURSE HANDOUT.docx` where there's no boundary after
  // the digits — so we don't require \b.
  const match = name.match(/^([A-Z]{2,4} Z[CG]\d{3,4})/);
  if (!match) return null;
  try {
    return normalizeBitsCourseNumber(match[1]!);
  } catch {
    return null;
  }
}

function parseAlternateCodes(raw: string): string[] {
  // BITS handouts join cross-listed codes with `/` or `,`. Take everything
  // after the first canonical code, split, normalize.
  const parts = raw
    .split(/[/,]/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length <= 1) return [];
  const out: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    try {
      out.push(normalizeBitsCourseNumber(parts[i]!));
    } catch {
      // Ignore parts that don't normalize.
    }
  }
  return out;
}

// ============================================================================
// Tier 1 — structured extraction from the tree
// ============================================================================

interface ExtractionState {
  warnings: string[];
  errors: string[];
}

function extractStructured(tree: Node[]): {
  data: BitsHandoutV1 | null;
  warnings: string[];
  errors: string[];
  bitsCourseNumber: string | null;
  alternateCodes: string[];
} {
  const state: ExtractionState = { warnings: [], errors: [] };

  // Part A header table — the first table containing "Course Title" or "Course No(s)" labels
  const partAHeader = findPartAHeaderTable(tree);
  if (!partAHeader) {
    state.errors.push('Part A header table not found.');
    return { data: null, ...state, bitsCourseNumber: null, alternateCodes: [] };
  }
  const partAFields = extractPartAHeader(partAHeader.rows, state);

  // 11f-b1 fix: real-corpus mammoth output renders Course Description as
  // `<p><strong>Course Description: </strong>The prose...</p>` — outside
  // the Part A header table entirely. After table extraction, fall back to
  // a paragraph-prefix scan if courseDescription is still missing.
  if (!partAFields.courseDescription) {
    partAFields.courseDescription = findCourseDescriptionFromParagraph(tree);
  }

  if (!partAFields.bitsCourseNumber) {
    state.errors.push(
      'Could not extract a valid BITS course number from Part A header (neither Course No(s) nor Course Title cell normalized).',
    );
  }

  // Find labeled tables (CO, LO, T-book, R-book, Part B, Evaluation).
  //
  // 11f-b1 correctness fixes (audit §1 fixture-vs-real convention): the
  // real-corpus mammoth HTML shape differs from synthetic fixtures in
  // three ways the original 11f-a parser missed:
  //
  //   - CO table's header row is "No | Course Objective" (not "Code | ...")
  //     — relax the first-cell regex to match either.
  //   - T-book and R-book tables have NO header row at all — they start
  //     directly with `T1 | citation` rows. Pass `null` for header regexes
  //     to indicate "take the next table after the label, regardless of
  //     its first row" + a flag that the first row IS data (not a header).
  //   - LO label has the suffix " : Students will be able to" attached —
  //     use a relaxed `.startsWith` match instead of `$`-anchored.
  //
  // The original failure mode (Survey C): all 286 imports hit placeholder
  // warnings for CO/LO/T-books because findTableAfterLabel's header check
  // was too strict for real-corpus tables.
  // 11f-b1: all four code-tables (CO/LO/T/R) use the adaptive firstRowIsData
  // mode. If the first row of the next table looks like a header (col0 matches
  // /^(code|no|s\.no)$/), it's treated as a header and skipped; otherwise the
  // synthetic-header trick keeps the first data row from being trimmed. This
  // handles both synthetic-fixture shape (header row) AND real-corpus shape
  // (no header row) uniformly.
  const coRows = findTableAfterLabel(tree, /^course objectives?\b/i, null, null, {
    firstRowIsData: true,
  });
  const loRows = findTableAfterLabel(
    tree,
    // No `$` — real corpus has " Learning Outcomes: Students will be able to"
    /^learning outcomes?\b/i,
    null,
    null,
    { firstRowIsData: true },
  );
  const tRows = findTableAfterLabel(tree, /^text ?books?\b/i, null, null, {
    firstRowIsData: true,
  });
  const rRows = findTableAfterLabel(tree, /^reference ?books?\b/i, null, null, {
    firstRowIsData: true,
  });
  // 11f-b1: real-corpus Part B header is "Contact Session | List of Topic
  // Title | Sub-Topics | Reference" — accept both "Topic Title" and
  // "List of Topic Title" header variants.
  const partBRows = findTableWithHeader(
    tree,
    /^(contact session|session)\b/i,
    /^(list of )?topic title/i,
  );
  // 11f-b1: real-corpus Evaluation header is "Evaluation Component | Name |
  // Type | Weight | Duration | Day, Date, Session, Time" — accept both the
  // synthetic-fixture form "EC No." and the real-corpus form.
  const evalRows = findTableWithHeader(tree, /^(ec ?no\.?|evaluation component)$/i, /^name/i);

  // Modular Content detection — drop with warning per the 11f-a synonym-map decision.
  if (hasParagraphMatching(tree, /^modular content structure$/i)) {
    state.warnings.push(
      'Modular Content section ignored; will be addressed in a later prompt (audit §1).',
    );
  }

  const courseObjectives = parseCodeDescriptionTable(coRows, 'CO');
  const learningOutcomes = parseCodeDescriptionTable(loRows, 'LO');
  const textBooks = parseCodeCitationTable(tRows, 'T');
  const referenceBooks = parseCodeCitationTable(rRows, 'R');
  const partBSessions = parsePartBTable(partBRows);
  const evalComponents = parseEvaluationTable(evalRows);

  // Build the BitsHandoutV1. Many fields are `min(1)` arrays — supply
  // placeholder rows when a section was missing so Zod parsing doesn't fail
  // the whole import. The admin UI flags placeholders via parseWarnings.
  const fallback = (_kind: string) => `(missing — placeholder generated by importer)`;

  const candidate = {
    schemaVersion: 1 as const,
    metadata: {
      institutionHeader: 'Birla Institute of Technology & Science, Pilani',
      divisionHeader: 'Work Integrated Learning Programmes Division',
      semester: partAFields.semester ?? 'First Semester 2025-2026',
      documentTitle: 'Digital Learning Handout',
      formNumber: '',
    },
    partA: {
      courseTitle: partAFields.courseTitle || 'Untitled course',
      courseNumbers: partAFields.bitsCourseNumber
        ? [partAFields.bitsCourseNumber, ...partAFields.alternateCodes]
        : ['UNKNOWN'],
      // Schema requires creditModel (audit §5: representational — never
      // fabricate hours from a bare ratio; `description` is the canonical
      // always-present field). When the source's Credit Units cell is blank,
      // provide an empty description and surface as a parseWarning so the
      // data-quality report flags it. Same discipline as the CO/LO
      // placeholders below.
      creditModel: { description: partAFields.creditModel ?? '' },
      instructors: partAFields.instructors.length > 0 ? partAFields.instructors : [''],
      date: partAFields.date ?? new Date().toLocaleDateString('en-GB'),
      courseDescription: partAFields.courseDescription
        ? `<p>${escapeHtml(partAFields.courseDescription)}</p>`
        : '<p></p>',
      courseObjectives:
        courseObjectives.length > 0
          ? courseObjectives
          : [{ code: 'CO1', description: fallback('CO') }],
      textBooks: textBooks.length > 0 ? textBooks : [{ code: 'T1', citation: fallback('T') }],
      referenceBooks,
      learningOutcomes:
        learningOutcomes.length > 0
          ? learningOutcomes
          : [{ code: 'LO1', description: fallback('LO') }],
    },
    partB: {
      sessions:
        partBSessions.length > 0
          ? partBSessions
          : [
              {
                sessionNumber: '1',
                topicTitle: fallback('session'),
                subTopics: '',
                references: [],
              },
            ],
    },
    evaluation: {
      legend: 'EC = Evaluation Component',
      components: evalComponents,
      notes: '',
      midSemSyllabus: '',
      compreSyllabus: '',
    },
    importantLinks: {
      elearnPortalUrl: 'https://elearn.bits-pilani.ac.in',
      elearnPortalNote: '',
      contactSessionsNote: '',
    },
    evaluationGuidelines: '<p></p>',
  };

  // Track which sections used placeholders so the admin UI surfaces them.
  if (!partAFields.creditModel)
    state.warnings.push(
      'Credit Units / credit model missing — empty placeholder generated (data-quality flag).',
    );
  if (courseObjectives.length === 0)
    state.warnings.push('Course Objectives missing — placeholder CO1 generated.');
  if (learningOutcomes.length === 0)
    state.warnings.push('Learning Outcomes missing — placeholder LO1 generated.');
  if (textBooks.length === 0) state.warnings.push('Text Books missing — placeholder T1 generated.');
  if (partBSessions.length === 0)
    state.warnings.push('Part B sessions missing — placeholder session generated.');
  if (evalComponents.length === 0)
    state.warnings.push(
      'Evaluation Scheme missing — empty components array (must equal 100% before save).',
    );

  const parsed = BitsHandoutSchemaV1.safeParse(candidate);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    state.errors.push(
      `Zod parse failed: ${first?.path.join('.') ?? '(root)'}: ${first?.message ?? 'invalid'}`,
    );
    return {
      data: null,
      warnings: state.warnings,
      errors: state.errors,
      bitsCourseNumber: partAFields.bitsCourseNumber,
      alternateCodes: partAFields.alternateCodes,
    };
  }

  return {
    data: parsed.data,
    warnings: state.warnings,
    errors: state.errors,
    bitsCourseNumber: partAFields.bitsCourseNumber,
    alternateCodes: partAFields.alternateCodes,
  };
}

// ---- Part A header extraction ----

interface PartAFields {
  bitsCourseNumber: string | null;
  alternateCodes: string[];
  courseTitle: string | null;
  creditModel: string | null;
  instructors: string[];
  date: string | null;
  courseDescription: string | null;
  semester: string | null;
}

function findPartAHeaderTable(tree: Node[]): TNode | null {
  for (const node of tree) {
    if (node.kind !== 'table') continue;
    const labels = node.rows.map((r) => r[0] ?? '');
    if (
      labels.some((l) => /^course title$/i.test(l)) &&
      labels.some((l) => /^course no/i.test(l))
    ) {
      return node;
    }
  }
  return null;
}

function extractPartAHeader(rows: string[][], state: ExtractionState): PartAFields {
  const out: PartAFields = {
    bitsCourseNumber: null,
    alternateCodes: [],
    courseTitle: null,
    creditModel: null,
    instructors: [],
    date: null,
    courseDescription: null,
    semester: null,
  };

  let rawCourseNo: string | null = null;
  let rawCourseTitle: string | null = null;

  for (const row of rows) {
    if (row.length < 2) continue;
    const label = row[0]!.trim();
    const value = row[1]!.trim();
    if (/^course title$/i.test(label)) rawCourseTitle = value;
    else if (/^course no/i.test(label)) rawCourseNo = value;
    else if (/^credit/i.test(label)) out.creditModel = value;
    else if (/^instructor/i.test(label))
      out.instructors = value
        .split(/[,;]/)
        .map((s) => s.trim())
        .filter(Boolean);
    else if (/^date\b/i.test(label)) out.date = value;
    else if (/^course description\b/i.test(label)) out.courseDescription = value;
  }

  // HHSM value-swap detection: if the Course No(s) cell doesn't normalize but
  // the Course Title cell does, swap them. Surface the swap as a warning so
  // admins know the source file had this irregularity.
  const courseNoOk = tryNormalize(rawCourseNo);
  const courseTitleOk = tryNormalize(rawCourseTitle);
  if (!courseNoOk && courseTitleOk) {
    state.warnings.push(
      `HHSM-style value swap detected: "Course No(s)" cell contained "${rawCourseNo}" (a course title), ` +
        `"Course Title" cell contained "${rawCourseTitle}" (a course code). Swapped.`,
    );
    out.bitsCourseNumber = courseTitleOk;
    out.alternateCodes = parseAlternateCodes(rawCourseTitle!);
    out.courseTitle = rawCourseNo;
  } else {
    out.courseTitle = rawCourseTitle;
    if (courseNoOk) {
      out.bitsCourseNumber = courseNoOk;
      out.alternateCodes = parseAlternateCodes(rawCourseNo!);
    }
  }

  return out;
}

function tryNormalize(s: string | null): string | null {
  if (!s) return null;
  // Take just the first slash/comma segment to validate; alternateCodes are
  // parsed separately. e.g. "AE ZG631/AEL ZG631" → validates on "AE ZG631".
  const first = s.split(/[/,]/)[0]!.trim();
  try {
    return normalizeBitsCourseNumber(first);
  } catch {
    return null;
  }
}

// ---- Labeled-table finders ----

function findTableAfterLabel(
  tree: Node[],
  labelRegex: RegExp,
  headerCol0: RegExp | null,
  headerCol1: RegExp | null,
  options: { firstRowIsData?: boolean } = {},
): string[][] {
  for (let i = 0; i < tree.length; i++) {
    const node = tree[i]!;
    if (node.kind === 'paragraph' && labelRegex.test(node.text)) {
      // Look for the next table within the next few nodes.
      for (let j = i + 1; j < Math.min(i + 4, tree.length); j++) {
        const next = tree[j]!;
        if (next.kind === 'table') {
          // No header constraints: take the next table as-is.
          //
          // 11f-b1 fix: when `firstRowIsData: true` is set, real-corpus
          // tables often have no header row at all (e.g., T-book table
          // starts directly with `T1 | citation`). The downstream parser
          // (parseCodeCitationTable) does `.slice(1)` to skip the header,
          // so we prepend a synthetic header — UNLESS the first row already
          // LOOKS like a header (col0 matches "Code" / "No"), in which case
          // we trust the caller / synthetic fixture and leave it alone.
          if (!headerCol0 && !headerCol1) {
            if (options.firstRowIsData && !rowLooksLikeHeader(next.rows[0])) {
              return [['__header__', '__header__'], ...next.rows];
            }
            return next.rows;
          }
          if (matchesHeader(next.rows, headerCol0, headerCol1)) {
            return next.rows;
          }
        }
      }
    }
  }
  return [];
}

function rowLooksLikeHeader(row: string[] | undefined): boolean {
  if (!row || row.length === 0) return false;
  const c0 = (row[0] ?? '').trim();
  return /^(code|no\.?|s\.?\s?no\.?)$/i.test(c0);
}

function findTableWithHeader(tree: Node[], col0: RegExp, col1: RegExp): string[][] {
  for (const node of tree) {
    if (node.kind !== 'table') continue;
    if (matchesHeader(node.rows, col0, col1)) return node.rows;
  }
  return [];
}

function matchesHeader(rows: string[][], col0?: RegExp | null, col1?: RegExp | null): boolean {
  if (rows.length === 0) return false;
  const first = rows[0]!;
  if (col0 && !col0.test(first[0] ?? '')) return false;
  if (col1 && !col1.test(first[1] ?? '')) return false;
  return true;
}

function hasParagraphMatching(tree: Node[], regex: RegExp): boolean {
  return tree.some((n) => n.kind === 'paragraph' && regex.test(n.text));
}

/**
 * 11f-b1 fix: scan for a paragraph starting with "Course Description:" and
 * return everything after the colon as the description text. Real corpus
 * mammoth output renders this as `<p><strong>Course Description:</strong>
 * The prose...</p>` — `<strong>` is stripped by parseHtmlToTree leaving the
 * paragraph text as `"Course Description: The prose..."`.
 */
function findCourseDescriptionFromParagraph(tree: Node[]): string | null {
  for (const node of tree) {
    if (node.kind !== 'paragraph') continue;
    const m = node.text.match(/^course description\s*:\s*(.+)$/i);
    if (m && m[1] && m[1].trim().length >= 20) {
      return m[1].trim();
    }
  }
  return null;
}

// ---- Per-section parsers ----

/**
 * 11f-b1: Filter rows to only those whose code matches the schema's regex
 * (`/^CO\d+$/`, `/^LO\d+$/`, etc.). Real corpus tables sometimes interleave
 * non-coded rows (totals, blank rows, multi-line description continuations)
 * that the schema rejects. Returning only schema-valid rows keeps the import
 * succeeding; the dropped rows are silent — they're typically benign artifacts
 * (e.g., a row whose first cell is "Self-study Hours" instead of "CO1").
 */
function parseCodeDescriptionTable(
  rows: string[][],
  codePrefix: 'CO' | 'LO',
): Array<{ code: string; description: string }> {
  const codeRegex = new RegExp(`^${codePrefix}\\s*\\d+$`, 'i');
  return rows.slice(1).flatMap((r) => {
    if (r.length < 2) return [];
    const code = (r[0] ?? '').trim().replace(/\s+/g, '');
    const description = (r[1] ?? '').trim();
    if (!description) return [];
    if (!codeRegex.test(code)) return [];
    // Normalize the code to the canonical form (e.g., "CO 1" → "CO1").
    return [{ code: code.toUpperCase(), description }];
  });
}

function parseCodeCitationTable(
  rows: string[][],
  codePrefix: 'T' | 'R',
): Array<{ code: string; citation: string }> {
  const codeRegex = new RegExp(`^${codePrefix}\\s*\\d+$`, 'i');
  return rows.slice(1).flatMap((r) => {
    if (r.length < 2) return [];
    const code = (r[0] ?? '').trim().replace(/\s+/g, '');
    const citation = (r[1] ?? '').trim();
    if (!citation) return [];
    if (!codeRegex.test(code)) return [];
    return [{ code: code.toUpperCase(), citation }];
  });
}

function parsePartBTable(rows: string[][]): Array<{
  sessionNumber: string;
  topicTitle: string;
  subTopics: string;
  references: string[];
}> {
  // Drop the header row. Expected columns: Session | Topic Title | Sub-Topics | Reference.
  return rows.slice(1).flatMap((r) => {
    if (r.length < 2) return [];
    const sessionNumber = (r[0] ?? '').trim();
    const topicTitle = (r[1] ?? '').trim();
    if (!sessionNumber || !topicTitle) return [];
    const subTopicsRaw = (r[2] ?? '').trim();
    // Already-joined "; " form OR newline-separated OR semicolon-separated.
    // The renderer split contract (audit §5) is "; ". Normalize to that.
    const subTopics = subTopicsRaw
      .split(/[;\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .join('; ');
    const referencesRaw = (r[3] ?? '').trim();
    const references = referencesRaw
      ? referencesRaw
          .split(/[,;]/)
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    return [{ sessionNumber, topicTitle, subTopics, references }];
  });
}

function parseEvaluationTable(rows: string[][]): BitsHandoutV1['evaluation']['components'] {
  // Expected columns: EC No | Name | Type | Weight | Duration. Group sub-
  // components under their EC number. Real corpus uses rowspan on the EC
  // cell when an EC has multiple sub-components — mammoth's HTML output
  // produces rows with one fewer cell after the rowspan'd row. We detect
  // this by checking whether the first cell looks like an EC code (e.g.,
  // "EC-1", "EC - 1", "EC 1") and inherit the previous EC code otherwise.
  const groups = new Map<string, BitsHandoutV1['evaluation']['components'][number]>();
  let currentEc: string | null = null;
  const ecCodeRegex = /^EC\s*[-–]?\s*\d+$/i;
  for (const r of rows.slice(1)) {
    if (r.length < 3) continue;
    const firstCell = (r[0] ?? '').trim();
    let ecNumber: string;
    let cellOffset: number;
    if (ecCodeRegex.test(firstCell)) {
      // Normalize to canonical "EC-N" form (collapse spaces and dashes).
      ecNumber = firstCell.toUpperCase().replace(/\s+/g, '').replace(/–/g, '-');
      // Ensure single-dash form if input was "EC1" without dash.
      if (!ecNumber.includes('-')) ecNumber = ecNumber.replace(/^EC/, 'EC-');
      currentEc = ecNumber;
      cellOffset = 0;
    } else if (currentEc) {
      // Rowspan'd EC cell — inherit from previous row. Shift indices by -1.
      ecNumber = currentEc;
      cellOffset = -1;
    } else {
      // No EC context established yet; skip the row.
      continue;
    }
    const name = (r[1 + cellOffset] ?? '').trim();
    const type = (r[2 + cellOffset] ?? '').trim();
    const weightRaw = (r[3 + cellOffset] ?? '').trim().replace(/%/g, '');
    const duration = (r[4 + cellOffset] ?? '').trim();
    if (!name) continue;
    const weight = Number.parseFloat(weightRaw);
    if (!Number.isFinite(weight)) continue;
    let g = groups.get(ecNumber);
    if (!g) {
      g = { ecNumber, subComponents: [] };
      groups.set(ecNumber, g);
    }
    g.subComponents.push({ name, type, weight, duration });
  }
  return Array.from(groups.values());
}

// ============================================================================
// Tier 2 — text-fallback extraction
// ============================================================================

async function safeExtractRawText(filePath: string): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  } catch {
    return '';
  }
}

function extractFromText(text: string): {
  data: BitsHandoutV1 | null;
  warnings: string[];
  errors: string[];
  bitsCourseNumber: string | null;
  alternateCodes: string[];
} {
  // Tier 2 is a deliberately weaker pass — used when Tier 1's table walker
  // couldn't find the Part A header table. It only attempts the course
  // number; everything else is left empty / placeholder. This is enough for
  // the admin UI to filter by course number and queue a manual re-parse.
  if (!text || text.length < 100) {
    return {
      data: null,
      warnings: [],
      errors: ['Text-fallback: extracted text was empty or too short.'],
      bitsCourseNumber: null,
      alternateCodes: [],
    };
  }

  // Look for a canonical-form course number anywhere in the text.
  const candidates = text.match(/\b[A-Z]{2,4} Z[CG]\d{3,4}\b/g) ?? [];
  let bitsCourseNumber: string | null = null;
  const alternateCodes: string[] = [];
  for (const c of candidates) {
    try {
      const canonical = normalizeBitsCourseNumber(c);
      if (!bitsCourseNumber) bitsCourseNumber = canonical;
      else if (canonical !== bitsCourseNumber && !alternateCodes.includes(canonical)) {
        alternateCodes.push(canonical);
      }
    } catch {
      // ignore
    }
  }

  if (!bitsCourseNumber) {
    return {
      data: null,
      warnings: [],
      errors: ['Text-fallback: no normalizable BITS course number found.'],
      bitsCourseNumber: null,
      alternateCodes: [],
    };
  }

  // Tier 2 doesn't try to assemble a full BitsHandoutV1. It returns
  // bitsCourseNumber for indexing, leaves data: null, and lets the admin UI
  // surface it as "course identified, content not extracted — manual re-import
  // needed."
  return {
    data: null,
    warnings: [
      'Text-fallback identified the course number but could not extract structured content. Manual re-import recommended.',
    ],
    errors: [],
    bitsCourseNumber,
    alternateCodes,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Convenience wrapper: read file metadata + body in one call. Caller usually
 * already has the metadata (the import action walks the directory); this is
 * here for tests and ad-hoc invocations.
 */
export async function parseDocxFile(filePath: string): Promise<ParseResult> {
  const buf = await readFile(filePath);
  return parseDocxToHandout({ filePath, fileBytes: buf.length });
}

import type { BitsHandoutV1 } from '@hmp/db';

/**
 * Compare two structured handouts (e.g. last year's and this year's) section
 * by section, for the Handout Library viewer.
 *
 * Pure: no DB, no React. Every value is reduced to normalised PLAIN TEXT
 * (HTML stripped, entities decoded, whitespace collapsed) before comparing, so
 * markup-only edits (`<p>x</p>` vs `x`, `&nbsp;` vs a space) never count as a
 * change. Coded items (CO1, T1, R1, LO1, sessions, evaluation rows) are matched
 * by their code, never by position: a renumbered list shows as added/removed
 * items rather than a cascade of false "changed" rows.
 *
 * Deliberately NOT compared (they change every offering and would make every
 * handout look "changed"): metadata header/semester, version number, date,
 * evaluation `scheduledAt`, the evaluation legend, and the important-links
 * block (portal URL boilerplate).
 */

export type ChangeKind = 'same' | 'added' | 'removed' | 'changed';

export interface WordDiff {
  text: string;
  op: 'eq' | 'add' | 'del';
}

export interface CompareRow {
  key: string;
  label: string;
  kind: ChangeKind;
  /** Plain text of the older handout's value; null when absent there. */
  before: string | null;
  /** Plain text of the newer handout's value; null when absent there. */
  after: string | null;
  /** Word-level diff — only present for 'changed' rows. */
  words?: WordDiff[];
}

export interface CompareSection {
  key: string;
  title: string;
  rows: CompareRow[];
  /** Number of rows whose kind is not 'same'. */
  changed: number;
}

export type ChangeSize = 'none' | 'small' | 'medium' | 'large';

export interface HandoutComparison {
  sections: CompareSection[];
  size: ChangeSize;
  changedRows: number;
  totalRows: number;
}

export const CHANGE_SIZE_LABEL: Record<ChangeSize, string> = {
  none: 'No changes',
  small: 'Small changes',
  medium: 'Some changes',
  large: 'Changed a lot',
};

// ---------------------------------------------------------------------------
// Plain-text normalisation
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntity(match: string, body: string): string {
  if (body[0] === '#') {
    const hex = body[1] === 'x' || body[1] === 'X';
    const code = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
    if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
    // Non-breaking space (160) collapses like any other whitespace.
    if (code === 160) return ' ';
    try {
      return String.fromCodePoint(code);
    } catch {
      return match;
    }
  }
  return NAMED_ENTITIES[body.toLowerCase()] ?? match;
}

/**
 * HTML to normalised plain text: block boundaries (`<br>`, `</p>`, `<li>`,
 * `</div>`, headings, table cells) become spaces, all other tags are dropped,
 * entities (`&amp; &lt; &gt; &quot; &#39; &nbsp;` and numeric `&#NN;`/`&#xHH;`)
 * are decoded in a single pass (so `&amp;lt;` decodes to the literal `&lt;`,
 * not `<`), and every whitespace run (including non-breaking spaces) collapses
 * to one space. Plain text without markup passes through unchanged apart from
 * whitespace collapsing.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|ul|ol|h[1-6]|tr|td|th|blockquote|pre)\s*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z]+);/g, decodeEntity)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalised text, or null when there is nothing visible. */
function text(value: string | null | undefined): string | null {
  if (value == null) return null;
  const t = stripHtml(value);
  return t.length > 0 ? t : null;
}

// ---------------------------------------------------------------------------
// Word diff
// ---------------------------------------------------------------------------

/**
 * Above this many words (on either side, after trimming the common prefix and
 * suffix) the LCS table would get large (n*m cells), so the diff degrades to
 * one "removed" + one "added" token. Real handout fields are well under this.
 */
const MAX_LCS_WORDS = 400;

function pushToken(out: WordDiff[], op: WordDiff['op'], words: string[]): void {
  if (words.length === 0) return;
  const last = out[out.length - 1];
  if (last && last.op === op) last.text += ' ' + words.join(' ');
  else out.push({ op, text: words.join(' ') });
}

/**
 * Word-level diff of two normalised strings. Consecutive words with the same
 * op are merged into one token, so the output alternates ops.
 */
export function diffWords(before: string, after: string): WordDiff[] {
  const a = before ? before.split(' ') : [];
  const b = after ? after.split(' ') : [];

  // Trim common prefix/suffix first — cheap, and keeps long texts with a small
  // edit under the LCS limit.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);

  const out: WordDiff[] = [];
  pushToken(out, 'eq', a.slice(0, start));

  if (midA.length > MAX_LCS_WORDS || midB.length > MAX_LCS_WORDS) {
    pushToken(out, 'del', midA);
    pushToken(out, 'add', midB);
  } else {
    const n = midA.length;
    const m = midB.length;
    // lcs[i][j] = LCS length of midA[i..] and midB[j..], flattened.
    const w = m + 1;
    const lcs = new Uint16Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i * w + j] =
          midA[i] === midB[j]
            ? lcs[(i + 1) * w + j + 1]! + 1
            : Math.max(lcs[(i + 1) * w + j]!, lcs[i * w + j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        pushToken(out, 'eq', [midA[i]!]);
        i++;
        j++;
      } else if (lcs[(i + 1) * w + j]! >= lcs[i * w + j + 1]!) {
        pushToken(out, 'del', [midA[i]!]);
        i++;
      } else {
        pushToken(out, 'add', [midB[j]!]);
        j++;
      }
    }
    pushToken(out, 'del', midA.slice(i));
    pushToken(out, 'add', midB.slice(j));
  }

  pushToken(out, 'eq', a.slice(endA));
  return out;
}

// ---------------------------------------------------------------------------
// Rows and keyed matching
// ---------------------------------------------------------------------------

function makeRow(
  key: string,
  label: string,
  before: string | null,
  after: string | null,
): CompareRow {
  if (before === after) return { key, label, kind: 'same', before, after };
  if (before === null) return { key, label, kind: 'added', before, after };
  if (after === null) return { key, label, kind: 'removed', before, after };
  return { key, label, kind: 'changed', before, after, words: diffWords(before, after) };
}

/** A single-value row; omitted when both sides are empty. */
function fieldRow(
  key: string,
  label: string,
  before: string | null | undefined,
  after: string | null | undefined,
): CompareRow[] {
  const b = text(before);
  const a = text(after);
  if (b === null && a === null) return [];
  return [makeRow(key, label, b, a)];
}

interface KeyedItem {
  /** Match key (normalised). */
  key: string;
  label: string;
  text: string | null;
}

/**
 * Give duplicate keys a stable suffix (`CO1`, `CO1#2`) so two items sharing a
 * code are matched by occurrence instead of one silently overwriting the other.
 */
function dedupeKeys(items: KeyedItem[]): KeyedItem[] {
  const seen = new Map<string, number>();
  return items.map((it) => {
    const n = (seen.get(it.key) ?? 0) + 1;
    seen.set(it.key, n);
    return n === 1 ? it : { ...it, key: `${it.key}#${n}` };
  });
}

/**
 * Match two keyed lists by key and emit rows in a deterministic merged order:
 * the newer list's order, with items only in the older list slotted in where
 * they used to sit relative to their neighbours (leftovers at the end).
 */
function keyedRows(
  prefix: string,
  beforeItems: KeyedItem[],
  afterItems: KeyedItem[],
): CompareRow[] {
  const before = dedupeKeys(beforeItems);
  const after = dedupeKeys(afterItems);
  const beforeMap = new Map(before.map((it) => [it.key, it]));
  const afterSet = new Set(after.map((it) => it.key));

  const rows: CompareRow[] = [];
  const emitRemoved = (it: KeyedItem) =>
    rows.push(makeRow(`${prefix}:${it.key}`, it.label, it.text ?? '', null));

  let i = 0;
  for (const it of after) {
    while (i < before.length && !afterSet.has(before[i]!.key)) emitRemoved(before[i++]!);
    const old = beforeMap.get(it.key);
    // Present on both sides: compare. A row that exists on a side counts as
    // present even if its text is empty, so normalise null to ''.
    rows.push(
      makeRow(`${prefix}:${it.key}`, it.label, old ? (old.text ?? '') : null, it.text ?? ''),
    );
    if (i < before.length && before[i]!.key === it.key) i++;
  }
  for (; i < before.length; i++) {
    if (!afterSet.has(before[i]!.key)) emitRemoved(before[i]!);
  }
  return rows;
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toUpperCase();

function codedItems(
  items: ReadonlyArray<{ code: string; description?: string; citation?: string }>,
): KeyedItem[] {
  return items.map((it) => ({
    key: norm(it.code),
    label: it.code.trim(),
    text: text(it.description ?? it.citation ?? ''),
  }));
}

function joinParts(parts: Array<string | null | undefined>, sep = ' · '): string | null {
  const kept = parts.map((p) => text(p)).filter((p): p is string => p !== null);
  return kept.length > 0 ? kept.join(sep) : null;
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

type H = BitsHandoutV1;

function courseDetailsRows(b: H, a: H): CompareRow[] {
  const credit = (h: H) => {
    const cm = h.partA.creditModel;
    const hours =
      cm.classroomHours != null || cm.tutorialHours != null || cm.preparationHours != null
        ? ` (Classroom ${cm.classroomHours ?? 0}h, Tutorial ${cm.tutorialHours ?? 0}h, Preparation ${cm.preparationHours ?? 0}h)`
        : '';
    return `${cm.description}${hours}`;
  };
  return [
    ...fieldRow('title', 'Course title', b.partA.courseTitle, a.partA.courseTitle),
    ...fieldRow(
      'courseNumbers',
      'Course number(s)',
      b.partA.courseNumbers.join(' / '),
      a.partA.courseNumbers.join(' / '),
    ),
    ...fieldRow(
      'creditUnits',
      'Credit units',
      b.partA.creditUnits != null ? String(b.partA.creditUnits) : null,
      a.partA.creditUnits != null ? String(a.partA.creditUnits) : null,
    ),
    ...fieldRow(
      'instructors',
      'Instructors',
      b.partA.instructors.join(', '),
      a.partA.instructors.join(', '),
    ),
    ...fieldRow('creditModel', 'Credit model', credit(b), credit(a)),
  ];
}

function sessionItems(h: H): KeyedItem[] {
  return h.partB.sessions.map((s) => {
    const refs = s.references.map((r) => r.trim()).filter(Boolean);
    return {
      key: norm(s.sessionNumber).replace(/\s*-\s*/g, '-'),
      label: `Session ${s.sessionNumber.trim()}`,
      text: joinParts([
        s.topicTitle,
        // Sub-topics are stored "; "-joined (the renderer splits them into
        // bullets); keep the separator so the text reads like the list.
        s.subTopics,
        refs.length > 0 ? `References: ${refs.join(', ')}` : null,
      ]),
    };
  });
}

function experientialRows(b: H, a: H): CompareRow[] {
  const eb = b.experientialLearning;
  const ea = a.experientialLearning;
  if (!eb && !ea) return [];
  const components = (h: H['experientialLearning']): KeyedItem[] =>
    (h?.components ?? []).map((c) => ({
      key: norm(c.name),
      label: `Component: ${c.name.trim()}`,
      text: joinParts([
        c.objective && `Objective: ${c.objective}`,
        c.outcome && `Outcome: ${c.outcome}`,
        c.labInfrastructure && `Lab infrastructure: ${c.labInfrastructure}`,
        c.numberOfExercises && `Exercises: ${c.numberOfExercises}`,
        c.scope && `Scope: ${c.scope}`,
      ]),
    }));
  const experiments = (h: H['experientialLearning']): KeyedItem[] =>
    (h?.experiments ?? []).map((e) => {
      // "6." and "6" are the same experiment.
      const num = e.experimentNumber.trim().replace(/\.+$/, '');
      return {
        key: norm(num),
        label: `Experiment ${num}`,
        text: joinParts([e.title, e.moduleReference && `Module: ${e.moduleReference}`]),
      };
    });
  return [
    ...fieldRow('objective', 'Objective', eb?.overallObjective, ea?.overallObjective),
    ...fieldRow('scope', 'Scope', eb?.overallScope.join('; '), ea?.overallScope.join('; ')),
    ...keyedRows('component', components(eb), components(ea)),
    ...fieldRow(
      'labInfrastructure',
      'Lab infrastructure',
      eb?.labInfrastructure.join('; '),
      ea?.labInfrastructure.join('; '),
    ),
    ...keyedRows('experiment', experiments(eb), experiments(ea)),
  ];
}

function evaluationItems(h: H): KeyedItem[] {
  return h.evaluation.components.flatMap((c) =>
    c.subComponents.map((sc) => ({
      key: `${norm(c.ecNumber)} ${norm(stripHtml(sc.name))}`,
      label: `${c.ecNumber.trim()} · ${stripHtml(sc.name)}`,
      text: joinParts([sc.name, sc.type, `${sc.weight}%`, sc.duration]),
    })),
  );
}

function evaluationRows(b: H, a: H): CompareRow[] {
  return [
    ...keyedRows('ec', evaluationItems(b), evaluationItems(a)),
    ...fieldRow('notes', 'Notes', b.evaluation.notes, a.evaluation.notes),
    ...fieldRow(
      'midSemSyllabus',
      'Mid-semester test syllabus',
      b.evaluation.midSemSyllabus,
      a.evaluation.midSemSyllabus,
    ),
    ...fieldRow(
      'compreSyllabus',
      'Comprehensive exam syllabus',
      b.evaluation.compreSyllabus,
      a.evaluation.compreSyllabus,
    ),
  ];
}

function section(key: string, title: string, rows: CompareRow[]): CompareSection {
  return { key, title, rows, changed: rows.filter((r) => r.kind !== 'same').length };
}

/**
 * Change-size thresholds — share of compared rows that differ:
 *   0 changed            → 'none'
 *   ratio <  0.15        → 'small'   (a few edits)
 *   0.15 <= ratio < 0.4  → 'medium'  (noticeable revision)
 *   ratio >= 0.4         → 'large'   (drives the "Changed a lot since last year" filter)
 */
export function changeSize(changedRows: number, totalRows: number): ChangeSize {
  if (changedRows <= 0 || totalRows <= 0) return 'none';
  const ratio = changedRows / totalRows;
  if (ratio < 0.15) return 'small';
  if (ratio < 0.4) return 'medium';
  return 'large';
}

/**
 * Compare an older handout (`before`) with a newer one (`after`).
 * Sections with no rows on either side (e.g. no experiential learning in
 * both) are left out entirely.
 */
export function compareHandouts(before: BitsHandoutV1, after: BitsHandoutV1): HandoutComparison {
  const b = before;
  const a = after;
  const sections = [
    section('courseDetails', 'Course details', courseDetailsRows(b, a)),
    section('courseDescription', 'Course description', [
      ...fieldRow(
        'courseDescription',
        'Course description',
        b.partA.courseDescription,
        a.partA.courseDescription,
      ),
      ...fieldRow(
        'laboratoryComponent',
        'Laboratory component',
        b.partA.laboratoryComponent,
        a.partA.laboratoryComponent,
      ),
    ]),
    section(
      'courseObjectives',
      'Course objectives',
      keyedRows('co', codedItems(b.partA.courseObjectives), codedItems(a.partA.courseObjectives)),
    ),
    section(
      'textBooks',
      'Text books',
      keyedRows('t', codedItems(b.partA.textBooks), codedItems(a.partA.textBooks)),
    ),
    section(
      'referenceBooks',
      'Reference books',
      keyedRows('r', codedItems(b.partA.referenceBooks), codedItems(a.partA.referenceBooks)),
    ),
    section(
      'learningOutcomes',
      'Learning outcomes',
      keyedRows('lo', codedItems(b.partA.learningOutcomes), codedItems(a.partA.learningOutcomes)),
    ),
    section('sessions', 'Course plan (sessions)', keyedRows('s', sessionItems(b), sessionItems(a))),
    section('experiential', 'Experiential learning', experientialRows(b, a)),
    section('evaluation', 'Evaluation scheme', evaluationRows(b, a)),
    section(
      'evaluationGuidelines',
      'Evaluation guidelines',
      fieldRow(
        'evaluationGuidelines',
        'Evaluation guidelines',
        b.evaluationGuidelines,
        a.evaluationGuidelines,
      ),
    ),
  ].filter((s) => s.rows.length > 0);

  const totalRows = sections.reduce((n, s) => n + s.rows.length, 0);
  const changedRows = sections.reduce((n, s) => n + s.changed, 0);
  return { sections, size: changeSize(changedRows, totalRows), changedRows, totalRows };
}

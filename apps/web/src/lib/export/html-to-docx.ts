import { Paragraph, TextRun, ExternalHyperlink, type IParagraphOptions } from 'docx';

/**
 * Minimal HTML → docx paragraph converter for BITS handout rich-text fields
 * (Prompt 23-b). Handles exactly the TipTap allowlist
 * (packages/db/src/rich-text-allowlist.ts): p, br, strong, b, em, i, u, ul,
 * ol, li, a, span, code.
 *
 * Empirically the corpus only ever uses `<p>` (a 294-import survey found 588
 * `<p>` and zero other tags); the other 12 tags exist for faculty-authored
 * content from the structured editor. We hand-roll rather than pull in
 * `html-to-docx` — the subset is small, bounded, and known.
 *
 * Decisions (documented so they're not "fixed" later):
 *   - Nested inline formatting accumulates: `<strong><em>x</em></strong>` →
 *     a run that is both bold and italic.
 *   - `<ul>` → real docx bullets; `<ol>` → a manual "N. " text prefix (avoids
 *     coupling the converter to a Document-level numbering config). Good enough
 *     for the prose lists BITS handouts contain.
 *   - `<a href>` honours only http/https/mailto; any other scheme renders as
 *     plain text (defence-in-depth; stored data may not be pre-sanitised).
 *   - `<code>` → monospace run. `<span>` is a transparent passthrough.
 *   - Empty / whitespace-only input → `[]` (the caller omits the section).
 *   - `<br>` → a line break within the current paragraph.
 */

type Attrs = Record<string, string>;
type Node =
  | { type: 'text'; text: string }
  | { type: 'el'; tag: string; attrs: Attrs; children: Node[] };

interface Fmt {
  bold?: boolean;
  italics?: boolean;
  underline?: boolean;
  code?: boolean;
}

const BLOCK = new Set(['p', 'ul', 'ol', 'li']);
const VOID = new Set(['br']);
const SAFE_SCHEME = /^(https?:|mailto:)/i;

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Tokenise + build a shallow node tree. Tolerant of unclosed/extra tags. */
function parse(html: string): Node[] {
  const tokenRe = /<\/?([a-zA-Z0-9]+)((?:\s+[^>]*?)?)\/?>|([^<]+)/g;
  const root: Node = { type: 'el', tag: '#root', attrs: {}, children: [] };
  const stack: Extract<Node, { type: 'el' }>[] = [root];
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(html)) !== null) {
    const [full, tag, rawAttrs, text] = m;
    if (text != null) {
      const decoded = decodeEntities(text);
      if (decoded) stack[stack.length - 1]!.children.push({ type: 'text', text: decoded });
      continue;
    }
    const name = (tag ?? '').toLowerCase();
    const isClose = full.startsWith('</');
    if (isClose) {
      // Pop to the nearest matching open tag (tolerate mismatches).
      for (let i = stack.length - 1; i >= 1; i--) {
        if (stack[i]!.tag === name) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const attrs: Attrs = {};
    const attrRe = /([a-zA-Z-]+)\s*=\s*"([^"]*)"/g;
    let a: RegExpExecArray | null;
    while ((a = attrRe.exec(rawAttrs ?? '')) !== null) attrs[a[1]!.toLowerCase()] = a[2]!;
    const node: Extract<Node, { type: 'el' }> = { type: 'el', tag: name, attrs, children: [] };
    stack[stack.length - 1]!.children.push(node);
    if (!VOID.has(name) && !full.endsWith('/>')) stack.push(node);
  }
  return root.children;
}

function inlineRuns(nodes: Node[], fmt: Fmt): Array<TextRun | ExternalHyperlink> {
  const out: Array<TextRun | ExternalHyperlink> = [];
  for (const n of nodes) {
    if (n.type === 'text') {
      if (n.text) out.push(makeRun(n.text, fmt));
      continue;
    }
    switch (n.tag) {
      case 'strong':
      case 'b':
        out.push(...inlineRuns(n.children, { ...fmt, bold: true }));
        break;
      case 'em':
      case 'i':
        out.push(...inlineRuns(n.children, { ...fmt, italics: true }));
        break;
      case 'u':
        out.push(...inlineRuns(n.children, { ...fmt, underline: true }));
        break;
      case 'code':
        out.push(...inlineRuns(n.children, { ...fmt, code: true }));
        break;
      case 'span':
        out.push(...inlineRuns(n.children, fmt));
        break;
      case 'br':
        out.push(new TextRun({ break: 1 }));
        break;
      case 'a': {
        const href = n.attrs.href ?? '';
        const children = inlineRuns(n.children, fmt);
        if (SAFE_SCHEME.test(href)) {
          out.push(
            new ExternalHyperlink({
              link: href,
              children: children.length ? children : [makeRun(href, fmt)],
            }),
          );
        } else {
          out.push(...(children.length ? children : []));
        }
        break;
      }
      default:
        // Unknown / nested block — flatten its inline content.
        out.push(...inlineRuns(n.children, fmt));
    }
  }
  return out;
}

function makeRun(text: string, fmt: Fmt): TextRun {
  return new TextRun({
    text,
    bold: fmt.bold,
    italics: fmt.italics,
    underline: fmt.underline ? {} : undefined,
    font: fmt.code ? 'Courier New' : undefined,
  });
}

function para(
  children: Array<TextRun | ExternalHyperlink>,
  opts?: IParagraphOptions,
): Paragraph | null {
  if (children.length === 0) return null;
  return new Paragraph({ ...opts, children });
}

/**
 * Convert a rich-text HTML string into docx paragraphs. Returns `[]` for empty
 * or whitespace-only input so callers can decide whether to render the section.
 */
export function htmlToParagraphs(html: string | null | undefined): Paragraph[] {
  if (!html || !html.trim()) return [];
  const nodes = parse(html);
  const out: Paragraph[] = [];
  // Buffer for loose inline/text content that appears outside any block tag.
  let loose: Array<TextRun | ExternalHyperlink> = [];
  const flushLoose = () => {
    const p = para(loose);
    if (p) out.push(p);
    loose = [];
  };

  for (const n of nodes) {
    if (n.type === 'el' && BLOCK.has(n.tag)) {
      flushLoose();
      if (n.tag === 'p') {
        const p = para(inlineRuns(n.children, {}));
        if (p) out.push(p);
      } else if (n.tag === 'ul' || n.tag === 'ol') {
        const ordered = n.tag === 'ol';
        let idx = 0;
        for (const li of n.children) {
          if (li.type !== 'el' || li.tag !== 'li') continue;
          idx++;
          const runs = inlineRuns(li.children, {});
          if (ordered) {
            const p = para([new TextRun({ text: `${idx}. ` }), ...runs]);
            if (p) out.push(p);
          } else {
            const p = para(runs, { bullet: { level: 0 } });
            if (p) out.push(p);
          }
        }
      } else if (n.tag === 'li') {
        // Stray <li> outside a list — treat as a bulleted line.
        const p = para(inlineRuns(n.children, {}), { bullet: { level: 0 } });
        if (p) out.push(p);
      }
    } else if (n.type === 'text') {
      if (n.text.trim()) loose.push(makeRun(n.text, {}));
    } else {
      loose.push(...inlineRuns([n], {}));
    }
  }
  flushLoose();
  return out;
}

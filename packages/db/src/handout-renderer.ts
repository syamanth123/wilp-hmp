import DOMPurify from 'isomorphic-dompurify';
import type { BitsHandoutV1 } from './handout-schema';

/**
 * Render options for `renderBitsHandout`.
 */
export interface RenderOptions {
  /**
   * Where the CSS lives:
   * - `'inline'` (default) — emit a `<style>` block at the top. Used by the
   *   Mode B export ZIP and any standalone-document rendering.
   * - `'external'` — emit class names only; relies on a global stylesheet
   *   hosted by the consumer (in-app rendering can hook these classes).
   * - `'none'` — no `<style>` and no `style=` attributes. Used for tests and
   *   downstream-processing pipelines.
   */
  cssScope?: 'inline' | 'external' | 'none';
  /**
   * Skip the BITS Pilani / WILP / semester / document-title header. In-app
   * pages typically pass `true` because the app layout already shows this
   * context; standalone exports leave it `false` for a complete document.
   */
  omitInstitutionalHeader?: boolean;
}

// === Sanitization (applies to every rich-text field — see Prompt 11c
// "two things to confirm" #1: same allowlist across all four fields) ===

const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'u',
  'ul',
  'ol',
  'li',
  'a',
  'span',
  'code',
];
const ALLOWED_ATTR = ['href'];

function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
  });
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Render a sub-topics cell. Per the 11a audit note, the importer joins
 * source bullets with `"; "`; the renderer reverses this to recover the
 * bullet structure visually.
 *
 * - 0 items / empty input → render nothing (Review sessions look clean)
 * - 1 item                → render inline (no awkward one-item list)
 * - >1 items              → render as `<ul><li>…</li></ul>`
 *
 * Never split on `","` — the comma is bullet-internal content (e.g.
 * `"OBD, OBD2, OBD3, UDS"` is ONE bullet).
 */
function renderSubTopics(s: string): string {
  if (!s.trim()) return '';
  const parts = s
    .split(/;\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return esc(parts[0]!);
  return `<ul class="bits-handout-subtopics">${parts.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`;
}

function renderReferences(refs: readonly string[]): string {
  if (refs.length === 0) return '<span class="bits-handout-empty">—</span>';
  return refs.map(esc).join('<br>');
}

// === Pragmatic CSS (Prompt 11c CSS decision: "recognizably BITS, not
// pixel-perfect Word"). ~80 lines of focused structural styling. ===

const CSS = `
.bits-handout { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; line-height: 1.4; color: #222; max-width: 920px; margin: 0 auto; padding: 16px; }
.bits-handout h1 { font-size: 1.4em; text-align: center; margin: 0; font-weight: 600; }
.bits-handout h2 { font-size: 1.15em; border-bottom: 1px solid #555; padding-bottom: 4px; margin-top: 22px; }
.bits-handout h3 { font-size: 1.0em; margin-top: 14px; margin-bottom: 6px; }
.bits-handout .bits-handout-header { text-align: center; margin-bottom: 18px; }
.bits-handout .bits-handout-header > div { margin-top: 2px; }
.bits-handout table { border-collapse: collapse; border: 1px solid #555; width: 100%; margin-top: 8px; font-size: 0.95em; }
.bits-handout th, .bits-handout td { border: 1px solid #888; padding: 6px 10px; vertical-align: top; text-align: left; }
.bits-handout th { background: #eee; font-weight: 600; }
.bits-handout .bits-handout-prose { margin: 6px 0; }
.bits-handout .bits-handout-prose p { margin: 6px 0; }
.bits-handout ul.bits-handout-subtopics { margin: 0; padding-left: 18px; }
.bits-handout ul.bits-handout-subtopics li { margin: 2px 0; }
.bits-handout ul.bits-handout-bullets { margin: 6px 0 6px 18px; padding: 0; }
.bits-handout ul.bits-handout-bullets li { margin: 2px 0; }
.bits-handout .bits-handout-empty { color: #888; }
.bits-handout .bits-handout-footer { margin-top: 24px; padding-top: 8px; border-top: 1px solid #ccc; font-size: 0.85em; color: #555; text-align: center; }
`.trim();

// === Section renderers ===

function renderHeader(m: BitsHandoutV1['metadata']): string {
  return `<div class="bits-handout-header">
  <h1>${esc(m.institutionHeader)}</h1>
  <div>${esc(m.divisionHeader)}</div>
  <div>${esc(m.semester)}</div>
  <div><strong>${esc(m.documentTitle)}</strong></div>
</div>`;
}

function renderPartA(partA: BitsHandoutV1['partA']): string {
  const cm = partA.creditModel;
  const hourBreakdown =
    cm.classroomHours != null || cm.tutorialHours != null || cm.preparationHours != null
      ? ` (Classroom ${cm.classroomHours ?? 0}h · Tutorial ${cm.tutorialHours ?? 0}h · Preparation ${cm.preparationHours ?? 0}h)`
      : '';
  const out: string[] = [];
  out.push('<h2>Part A — Course Identification</h2>');
  out.push('<table><tbody>');
  out.push(`<tr><th>Course Title</th><td>${esc(partA.courseTitle)}</td></tr>`);
  out.push(`<tr><th>Course No(s)</th><td>${partA.courseNumbers.map(esc).join(' / ')}</td></tr>`);
  if (partA.creditUnits != null) {
    out.push(`<tr><th>Credit Units</th><td>${partA.creditUnits}</td></tr>`);
  }
  out.push(`<tr><th>Credit Model</th><td>${esc(cm.description)}${esc(hourBreakdown)}</td></tr>`);
  out.push(`<tr><th>Instructors</th><td>${partA.instructors.map(esc).join(', ')}</td></tr>`);
  if (partA.versionNo != null) {
    out.push(`<tr><th>Version No</th><td>${partA.versionNo}</td></tr>`);
  }
  out.push(`<tr><th>Date</th><td>${esc(partA.date)}</td></tr>`);
  out.push('</tbody></table>');
  out.push('<h3>Course Description</h3>');
  out.push(`<div class="bits-handout-prose">${sanitize(partA.courseDescription)}</div>`);
  if (partA.laboratoryComponent) {
    out.push('<h3>Laboratory Component</h3>');
    out.push(`<div class="bits-handout-prose">${sanitize(partA.laboratoryComponent)}</div>`);
  }
  out.push(renderCodedTable('Course Objectives', 'CO', partA.courseObjectives, 'Description'));
  out.push(renderCodedTable('Text Books', 'Code', partA.textBooks, 'Citation'));
  out.push(
    renderCodedTable(
      'Reference Books',
      'Code',
      partA.referenceBooks,
      'Citation',
      'No reference books listed.',
    ),
  );
  out.push(renderCodedTable('Learning Outcomes', 'LO', partA.learningOutcomes, 'Description'));
  return out.join('\n');
}

function renderCodedTable(
  title: string,
  codeLabel: string,
  rows: ReadonlyArray<{ code: string; description?: string; citation?: string }>,
  rightLabel: string,
  emptyMessage?: string,
): string {
  if (rows.length === 0) {
    return `<h2>${esc(title)}</h2><p class="bits-handout-empty">${esc(emptyMessage ?? 'None listed.')}</p>`;
  }
  const body = rows
    .map(
      (r) => `<tr><td>${esc(r.code)}</td><td>${esc(r.description ?? r.citation ?? '')}</td></tr>`,
    )
    .join('');
  return `<h2>${esc(title)}</h2>
<table>
  <thead><tr><th>${esc(codeLabel)}</th><th>${esc(rightLabel)}</th></tr></thead>
  <tbody>${body}</tbody>
</table>`;
}

function renderPartB(sessions: BitsHandoutV1['partB']['sessions']): string {
  const rows = sessions
    .map(
      (s) =>
        `<tr><td>${esc(s.sessionNumber)}</td><td>${esc(s.topicTitle)}</td><td>${renderSubTopics(
          s.subTopics,
        )}</td><td>${renderReferences(s.references)}</td></tr>`,
    )
    .join('');
  return `<h2>Part B — Learning Plan</h2>
<table>
  <thead><tr><th>Session</th><th>Topic</th><th>Sub-topics</th><th>References</th></tr></thead>
  <tbody>${rows}</tbody>
</table>`;
}

function renderExperiential(el: NonNullable<BitsHandoutV1['experientialLearning']>): string {
  const parts: string[] = ['<h2>Experiential Learning</h2>'];
  if (el.overallObjective.trim()) {
    parts.push('<h3>Objective</h3>');
    parts.push(`<div class="bits-handout-prose">${sanitize(el.overallObjective)}</div>`);
  }
  if (el.overallScope.length > 0) {
    parts.push('<h3>Scope</h3>');
    parts.push(
      `<ul class="bits-handout-bullets">${el.overallScope.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`,
    );
  }
  if (el.components.length > 0) {
    parts.push('<h3>Components</h3>');
    const cRows = el.components
      .map(
        (c) =>
          `<tr><td>${esc(c.name)}</td><td>${esc(c.objective)}</td><td>${esc(c.outcome)}</td><td>${esc(
            c.labInfrastructure,
          )}</td><td>${esc(c.numberOfExercises)}</td><td>${esc(c.scope)}</td></tr>`,
      )
      .join('');
    parts.push(`<table>
  <thead><tr><th>Name</th><th>Objective</th><th>Outcome</th><th>Lab Infrastructure</th><th># Exercises</th><th>Scope</th></tr></thead>
  <tbody>${cRows}</tbody>
</table>`);
  }
  if (el.labInfrastructure.length > 0) {
    parts.push('<h3>Lab Infrastructure</h3>');
    parts.push(
      `<ul class="bits-handout-bullets">${el.labInfrastructure.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`,
    );
  }
  if (el.experiments.length > 0) {
    parts.push('<h3>List of Experiments</h3>');
    const eRows = el.experiments
      .map(
        (e) =>
          `<tr><td>${esc(e.experimentNumber)}</td><td>${esc(e.title)}</td><td>${esc(e.moduleReference)}</td></tr>`,
      )
      .join('');
    parts.push(`<table>
  <thead><tr><th>#</th><th>Title</th><th>Module Reference</th></tr></thead>
  <tbody>${eRows}</tbody>
</table>`);
  }
  if (parts.length === 1) {
    // Section header only — everything was empty. Preserve structural rhythm
    // with a placeholder rather than an orphan heading.
    parts.push('<p class="bits-handout-empty">No experiential components listed.</p>');
  }
  return parts.join('\n');
}

function renderEvaluation(ev: BitsHandoutV1['evaluation']): string {
  const out: string[] = ['<h2>Evaluation Scheme</h2>'];
  if (ev.legend) out.push(`<p><em>${esc(ev.legend)}</em></p>`);
  if (ev.components.length === 0) {
    out.push('<p class="bits-handout-empty">No evaluation components listed.</p>');
    return out.join('\n');
  }
  const flat = ev.components.flatMap((c) =>
    c.subComponents.length === 0
      ? [{ ec: c.ecNumber, name: '—', type: '—', weight: 0, duration: '—', scheduledAt: '—' }]
      : c.subComponents.map((sc, i) => ({
          ec: i === 0 ? c.ecNumber : '',
          name: sc.name,
          type: sc.type,
          weight: sc.weight,
          duration: sc.duration,
          scheduledAt: sc.scheduledAt ?? '',
        })),
  );
  const rows = flat
    .map(
      (r) =>
        `<tr><td>${esc(r.ec)}</td><td>${esc(r.name)}</td><td>${esc(r.type)}</td><td>${r.weight}%</td><td>${esc(
          r.duration,
        )}</td><td>${esc(r.scheduledAt)}</td></tr>`,
    )
    .join('');
  out.push(`<table>
  <thead><tr><th>EC</th><th>Name</th><th>Type</th><th>Weight</th><th>Duration</th><th>Scheduled</th></tr></thead>
  <tbody>${rows}</tbody>
</table>`);
  return out.join('\n');
}

function renderImportantNotes(
  ev: BitsHandoutV1['evaluation'],
  links: BitsHandoutV1['importantLinks'],
): string {
  const parts: string[] = ['<h2>Important Notes</h2>'];
  if (ev.midSemSyllabus) {
    parts.push('<h3>Syllabus for Mid-Semester Test</h3>');
    parts.push(`<div class="bits-handout-prose">${sanitize(ev.midSemSyllabus)}</div>`);
  }
  if (ev.compreSyllabus) {
    parts.push('<h3>Syllabus for Comprehensive Examination</h3>');
    parts.push(`<div class="bits-handout-prose">${sanitize(ev.compreSyllabus)}</div>`);
  }
  parts.push('<h3>Important Links</h3>');
  parts.push(
    `<p>eLearn Portal: <a href="${esc(links.elearnPortalUrl)}">${esc(links.elearnPortalUrl)}</a></p>`,
  );
  if (links.elearnPortalNote) parts.push(`<p>${esc(links.elearnPortalNote)}</p>`);
  parts.push('<h3>Contact Sessions</h3>');
  if (links.contactSessionsNote) parts.push(`<p>${esc(links.contactSessionsNote)}</p>`);
  else parts.push('<p class="bits-handout-empty">—</p>');
  if (ev.notes) {
    parts.push('<h3>Additional Notes</h3>');
    parts.push(`<div class="bits-handout-prose">${sanitize(ev.notes)}</div>`);
  }
  return parts.join('\n');
}

function renderFooter(m: BitsHandoutV1['metadata'], partA: BitsHandoutV1['partA']): string {
  const segs: string[] = [];
  if (m.formNumber) segs.push(`Form ${esc(m.formNumber)}`);
  segs.push(esc(m.documentTitle));
  segs.push(esc(m.semester));
  if (partA.versionNo != null) segs.push(`Version ${partA.versionNo}`);
  if (partA.date) segs.push(esc(partA.date));
  return `<div class="bits-handout-footer">${segs.join(' · ')}</div>`;
}

/**
 * Render a `BitsHandoutV1` as BITS-format HTML.
 *
 * Pure function: no I/O, no Prisma, no React. Importable from both server-side
 * code (Mode B export ZIP, email body) and client-side code. Rich-text fields
 * (`courseDescription`, `laboratoryComponent`, `overallObjective`,
 * `evaluationGuidelines`, plus `evaluation.midSemSyllabus`/`compreSyllabus`/
 * `notes`) are sanitized via a tight DOMPurify allowlist before insertion.
 */
export function renderBitsHandout(data: BitsHandoutV1, options?: RenderOptions): string {
  const cssScope = options?.cssScope ?? 'inline';
  const omitHeader = options?.omitInstitutionalHeader ?? false;
  const parts: string[] = [];
  if (cssScope === 'inline') parts.push(`<style>${CSS}</style>`);
  parts.push('<div class="bits-handout">');
  if (!omitHeader) parts.push(renderHeader(data.metadata));
  parts.push(renderPartA(data.partA));
  parts.push(renderPartB(data.partB.sessions));
  if (data.experientialLearning) parts.push(renderExperiential(data.experientialLearning));
  parts.push(renderEvaluation(data.evaluation));
  parts.push(renderImportantNotes(data.evaluation, data.importantLinks));
  parts.push('<h2>Evaluation Guidelines</h2>');
  parts.push(`<div class="bits-handout-prose">${sanitize(data.evaluationGuidelines)}</div>`);
  parts.push(renderFooter(data.metadata, data.partA));
  parts.push('</div>');
  return parts.join('\n');
}

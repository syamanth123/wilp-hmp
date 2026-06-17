import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  AlignmentType,
  Header,
  Footer,
  ImageRun,
  PageNumber,
  ShadingType,
} from 'docx';
import type { BitsHandoutV1 } from '@hmp/db';
import { htmlToParagraphs } from './html-to-docx';

/**
 * BITS canonical Word (.docx) builder (Prompt 23-b). Pure: (data, logo) →
 * Buffer. Mirrors `renderBitsHandout`'s section walk
 * (packages/db/src/handout-renderer.ts) — the authoritative BITS-section
 * mapping — but emits a print-faithful Word document (Arial, A4, 1" margins,
 * the multi-campus BITS banner in the page header) rather than web-pragmatic
 * HTML.
 *
 * The logo bytes are passed IN (read by the route handler) so this stays pure
 * and free of cross-package asset paths.
 */

const ARIAL = 'Arial';
const A4 = { width: 11906, height: 16838 }; // twips
const MARGIN = 1440; // 1 inch in twips
const INK = '333333';
const GRID = '888888';
const HEADER_BG = 'EEEEEE';

// Banner is 764×1045 (portrait crest + wordmark); scale to a small header mark.
const LOGO = { width: 58, height: 79 };

function tableBorders() {
  const b = { style: BorderStyle.SINGLE, size: 4, color: GRID };
  return { top: b, bottom: b, left: b, right: b, insideHorizontal: b, insideVertical: b };
}

function textCell(text: string, opts: { header?: boolean; widthPct?: number } = {}): TableCell {
  return new TableCell({
    width: opts.widthPct ? { size: opts.widthPct, type: WidthType.PERCENTAGE } : undefined,
    shading: opts.header ? { type: ShadingType.CLEAR, color: 'auto', fill: HEADER_BG } : undefined,
    children: [
      new Paragraph({
        children: [new TextRun({ text, bold: opts.header, font: ARIAL, size: 20 })],
      }),
    ],
  });
}

function heading(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 240, after: 80 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: '555555' } },
    children: [new TextRun({ text, bold: true, font: ARIAL, size: 26 })],
  });
}

function subHeading(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 120, after: 40 },
    children: [new TextRun({ text, bold: true, font: ARIAL, size: 22 })],
  });
}

function bullets(items: readonly string[]): Paragraph[] {
  return items
    .filter((s) => s && s.trim())
    .map(
      (s) =>
        new Paragraph({
          bullet: { level: 0 },
          children: [new TextRun({ text: s, font: ARIAL, size: 22 })],
        }),
    );
}

function gridTable(header: string[], rows: string[][]): Table {
  const headerRow = new TableRow({
    tableHeader: true,
    children: header.map((h) => textCell(h, { header: true })),
  });
  const bodyRows = rows.map((r) => new TableRow({ children: r.map((c) => textCell(c)) }));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: tableBorders(),
    rows: [headerRow, ...bodyRows],
  });
}

function emptyNote(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, italics: true, color: '888888', font: ARIAL, size: 20 })],
  });
}

// ── Section builders (mirror handout-renderer.ts) ──────────────────────────

function partAInfoTable(partA: BitsHandoutV1['partA']): Table {
  const cm = partA.creditModel;
  const hours =
    cm.classroomHours != null || cm.tutorialHours != null || cm.preparationHours != null
      ? ` (Classroom ${cm.classroomHours ?? 0}h · Tutorial ${cm.tutorialHours ?? 0}h · Preparation ${cm.preparationHours ?? 0}h)`
      : '';
  const rows: Array<[string, string]> = [
    ['Course Title', partA.courseTitle],
    ['Course No(s)', partA.courseNumbers.join(' / ')],
  ];
  if (partA.creditUnits != null) rows.push(['Credit Units', String(partA.creditUnits)]);
  rows.push(['Credit Model', `${cm.description}${hours}`]);
  rows.push(['Instructors', partA.instructors.join(', ')]);
  if (partA.versionNo != null) rows.push(['Version No', String(partA.versionNo)]);
  rows.push(['Date', partA.date]);
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: tableBorders(),
    rows: rows.map(
      ([k, v]) =>
        new TableRow({
          children: [textCell(k, { header: true, widthPct: 28 }), textCell(v, { widthPct: 72 })],
        }),
    ),
  });
}

function codedTable(
  title: string,
  leftLabel: string,
  rightLabel: string,
  rows: ReadonlyArray<{ code: string; description?: string; citation?: string }>,
  emptyMessage?: string,
): (Paragraph | Table)[] {
  if (rows.length === 0) return [heading(title), emptyNote(emptyMessage ?? 'None listed.')];
  return [
    heading(title),
    gridTable(
      [leftLabel, rightLabel],
      rows.map((r) => [r.code, r.description ?? r.citation ?? '']),
    ),
  ];
}

function partBSection(sessions: BitsHandoutV1['partB']['sessions']): (Paragraph | Table)[] {
  return [
    heading('Part B — Learning Plan'),
    gridTable(
      ['Session', 'Topic', 'Sub-topics', 'References'],
      sessions.map((s) => [
        s.sessionNumber,
        s.topicTitle,
        s.subTopics.split(/;\s*/).filter(Boolean).join('; '),
        s.references.join(', '),
      ]),
    ),
  ];
}

function experientialSection(
  el: NonNullable<BitsHandoutV1['experientialLearning']>,
): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [heading('Experiential Learning')];
  if (el.overallObjective.trim()) {
    out.push(subHeading('Objective'), ...htmlToParagraphs(el.overallObjective));
  }
  if (el.overallScope.length) {
    out.push(subHeading('Scope'), ...bullets(el.overallScope));
  }
  if (el.components.length) {
    out.push(subHeading('Components'));
    out.push(
      gridTable(
        ['Name', 'Objective', 'Outcome', 'Lab Infrastructure', '# Exercises', 'Scope'],
        el.components.map((c) => [
          c.name,
          c.objective,
          c.outcome,
          c.labInfrastructure,
          c.numberOfExercises,
          c.scope,
        ]),
      ),
    );
  }
  if (el.labInfrastructure.length) {
    out.push(subHeading('Lab Infrastructure'), ...bullets(el.labInfrastructure));
  }
  if (el.experiments.length) {
    out.push(subHeading('List of Experiments'));
    out.push(
      gridTable(
        ['#', 'Title', 'Module Reference'],
        el.experiments.map((e) => [e.experimentNumber, e.title, e.moduleReference]),
      ),
    );
  }
  if (out.length === 1) out.push(emptyNote('No experiential components listed.'));
  return out;
}

function evaluationSection(ev: BitsHandoutV1['evaluation']): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [heading('Evaluation Scheme')];
  if (ev.legend)
    out.push(
      new Paragraph({
        children: [new TextRun({ text: ev.legend, italics: true, font: ARIAL, size: 20 })],
      }),
    );
  if (ev.components.length === 0) {
    out.push(emptyNote('No evaluation components listed.'));
    return out;
  }
  const flat = ev.components.flatMap((c) =>
    c.subComponents.length === 0
      ? [{ ec: c.ecNumber, name: '—', type: '—', weight: '0%', duration: '—', scheduledAt: '—' }]
      : c.subComponents.map((sc, i) => ({
          ec: i === 0 ? c.ecNumber : '',
          name: sc.name,
          type: sc.type,
          weight: `${sc.weight}%`,
          duration: sc.duration,
          scheduledAt: sc.scheduledAt ?? '',
        })),
  );
  out.push(
    gridTable(
      ['EC', 'Name', 'Type', 'Weight', 'Duration', 'Scheduled'],
      flat.map((r) => [r.ec, r.name, r.type, r.weight, r.duration, r.scheduledAt]),
    ),
  );
  return out;
}

function importantNotes(
  ev: BitsHandoutV1['evaluation'],
  links: BitsHandoutV1['importantLinks'],
): Paragraph[] {
  const out: Paragraph[] = [heading('Important Notes')];
  if (ev.midSemSyllabus)
    out.push(subHeading('Syllabus for Mid-Semester Test'), ...htmlToParagraphs(ev.midSemSyllabus));
  if (ev.compreSyllabus)
    out.push(
      subHeading('Syllabus for Comprehensive Examination'),
      ...htmlToParagraphs(ev.compreSyllabus),
    );
  out.push(subHeading('Important Links'));
  out.push(
    new Paragraph({
      children: [
        new TextRun({ text: `eLearn Portal: ${links.elearnPortalUrl}`, font: ARIAL, size: 22 }),
      ],
    }),
  );
  if (links.elearnPortalNote)
    out.push(
      new Paragraph({
        children: [new TextRun({ text: links.elearnPortalNote, font: ARIAL, size: 22 })],
      }),
    );
  out.push(subHeading('Contact Sessions'));
  out.push(
    links.contactSessionsNote
      ? new Paragraph({
          children: [new TextRun({ text: links.contactSessionsNote, font: ARIAL, size: 22 })],
        })
      : emptyNote('—'),
  );
  if (ev.notes) out.push(subHeading('Additional Notes'), ...htmlToParagraphs(ev.notes));
  return out;
}

function buildHeader(m: BitsHandoutV1['metadata'], logo: Buffer): Header {
  const titleLine = (text: string, bold = false, size = 22) =>
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text, bold, font: ARIAL, size })],
    });
  return new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new ImageRun({ type: 'png', data: logo, transformation: LOGO })],
      }),
      titleLine(m.institutionHeader, true, 24),
      titleLine(m.divisionHeader),
      titleLine(m.semester),
      titleLine(m.documentTitle, true),
    ],
  });
}

function buildFooter(m: BitsHandoutV1['metadata'], partA: BitsHandoutV1['partA']): Footer {
  const segs: string[] = [];
  if (m.formNumber) segs.push(`Form ${m.formNumber}`);
  segs.push(m.documentTitle, m.semester);
  if (partA.versionNo != null) segs.push(`Version ${partA.versionNo}`);
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text: `${segs.join(' · ')}  ·  Page `,
            font: ARIAL,
            size: 16,
            color: '777777',
          }),
          new TextRun({ children: [PageNumber.CURRENT], font: ARIAL, size: 16, color: '777777' }),
        ],
      }),
    ],
  });
}

/**
 * Build a BITS-canonical Word document from structured handout data.
 * @param data parsed `BitsHandoutV1`
 * @param logo PNG bytes of the multi-campus BITS banner (read by the caller)
 */
export async function buildHandoutDocx(data: BitsHandoutV1, logo: Buffer): Promise<Buffer> {
  const body: (Paragraph | Table)[] = [];

  // Part A
  body.push(heading('Part A — Course Identification'));
  body.push(partAInfoTable(data.partA));
  body.push(subHeading('Course Description'));
  body.push(...htmlToParagraphs(data.partA.courseDescription));
  if (data.partA.laboratoryComponent) {
    body.push(
      subHeading('Laboratory Component'),
      ...htmlToParagraphs(data.partA.laboratoryComponent),
    );
  }
  body.push(...codedTable('Course Objectives', 'CO', 'Description', data.partA.courseObjectives));
  body.push(...codedTable('Text Books', 'Code', 'Citation', data.partA.textBooks));
  body.push(
    ...codedTable(
      'Reference Books',
      'Code',
      'Citation',
      data.partA.referenceBooks,
      'No reference books listed.',
    ),
  );
  body.push(...codedTable('Learning Outcomes', 'LO', 'Description', data.partA.learningOutcomes));

  // Part B
  body.push(...partBSection(data.partB.sessions));

  // Experiential (optional)
  if (data.experientialLearning) body.push(...experientialSection(data.experientialLearning));

  // Evaluation + notes + guidelines
  body.push(...evaluationSection(data.evaluation));
  body.push(...importantNotes(data.evaluation, data.importantLinks));
  body.push(heading('Evaluation Guidelines'));
  body.push(...htmlToParagraphs(data.evaluationGuidelines));

  const doc = new Document({
    creator: 'HMP',
    title: `${data.partA.courseNumbers[0] ?? ''} — ${data.partA.courseTitle}`,
    styles: {
      default: { document: { run: { font: ARIAL, size: 22, color: INK } } },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: A4.width, height: A4.height },
            margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
          },
        },
        headers: { default: buildHeader(data.metadata, logo) },
        footers: { default: buildFooter(data.metadata, data.partA) },
        children: body,
      },
    ],
  });

  return Packer.toBuffer(doc);
}

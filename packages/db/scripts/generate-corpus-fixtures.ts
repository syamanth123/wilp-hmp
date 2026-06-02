/**
 * Synthetic .docx fixture generator for the corpus parser (Prompt 11f-a).
 *
 * Hand-constructs five .docx files that exercise specific parser code paths.
 * The fixtures live in `packages/db/src/__fixtures__/corpus-samples/`,
 * COMMITTED to the repo (unlike the real corpus, which is BITS IP and
 * gitignored). CI runs the parser against these — synthetic fixtures
 * eliminate the IP risk of shipping real corpus files even gitignored.
 *
 * Each fixture documents what parser path it exercises. Re-run with:
 *   pnpm --filter @hmp/db exec tsx scripts/generate-corpus-fixtures.ts
 *
 * Adding a new fixture: write a new `buildXxxDocx()` function below and add
 * it to `FIXTURES`. Keep each fixture minimal (just enough Part A / Part B /
 * Evaluation rows to satisfy `BitsHandoutSchemaV1`'s `min(1)` arrays).
 */

import { Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

// ---- Helpers ----

function p(text: string): Paragraph {
  return new Paragraph({ children: [new TextRun(text)] });
}

function cell(text: string): TableCell {
  return new TableCell({ children: [p(text)] });
}

function row(...cells: string[]): TableRow {
  return new TableRow({ children: cells.map(cell) });
}

function labeledTable(rows: TableRow[]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows,
  });
}

// ---- Fixture builders ----

/**
 * F1 — Standard CO/LO template (Tier 1 happy path).
 *
 * Mimics the AEL ZG631 shape: Part A header table with course title +
 * course no, CO/LO/T-book code tables, a small Part B sessions table, an
 * Evaluation Scheme table that sums to 100. Parser should produce a Zod-
 * valid BitsHandoutV1 via the MAMMOTH_STRUCTURED path.
 */
function buildStandardDocx(): Document {
  return new Document({
    creator: 'HMP Corpus Fixture Generator',
    title: 'F1 standard',
    sections: [
      {
        children: [
          // Institutional header
          p('Birla Institute of Technology & Science, Pilani'),
          p('Work Integrated Learning Programmes Division'),
          p('First Semester 2025-2026'),
          p('Digital Learning Handout'),
          p('Part A: Content Design'),
          // Part A header table — standard layout (Course Title, Course No(s))
          labeledTable([
            row('Course Title', 'Software Quality Assurance'),
            row('Course No(s)', 'SE ZG501'),
            row('Credit Units', '3'),
            row('Instructor(s)', 'Dr. Test Faculty'),
            row('Course Author', 'Dr. Test Faculty'),
            row('Version No.', '1.0'),
            row('Date', '01-Aug-2025'),
            row('Course Description', 'Foundations of software quality assurance.'),
          ]),
          // Course Objectives table
          p('Course Objectives'),
          labeledTable([
            row('Code', 'Course Objective'),
            row('CO1', 'Understand SQA principles'),
            row('CO2', 'Apply test design techniques'),
          ]),
          // Text Books table
          p('Text Book(s)'),
          labeledTable([
            row('Code', 'Reference'),
            row('T1', 'Pressman, Software Engineering, 8th ed.'),
          ]),
          // Reference Books
          p('Reference Book(s) & other resources'),
          labeledTable([
            row('Code', 'Reference'),
            row('R1', 'Beizer, Software Testing Techniques.'),
          ]),
          // Learning Outcomes
          p('Learning Outcomes'),
          labeledTable([
            row('Code', 'Learning Outcome'),
            row('LO1', 'Design test plans'),
            row('LO2', 'Run quality reviews'),
          ]),
          p('Part B: Contact Session Plan'),
          labeledTable([
            row('Contact Session', 'Topic Title', 'Sub-Topics', 'Reference'),
            row('1', 'Introduction to SQA', 'History; Standards', 'T1 Ch. 1'),
            row('2', 'Test design', 'Equivalence partitioning; Boundary value', 'T1 Ch. 5'),
          ]),
          p('Evaluation Scheme'),
          labeledTable([
            row('EC No.', 'Name', 'Type', 'Weight', 'Duration'),
            row('EC-1', 'Quiz', 'Online', '20', '30m'),
            row('EC-2', 'Mid-Sem', 'Closed Book', '30', '90m'),
            row('EC-3', 'Comprehensive', 'Open Book', '50', '180m'),
          ]),
          // Important links
          p('Important Links'),
          p('elearn.bits-pilani.ac.in'),
          p('Evaluation Guidelines'),
          p('Make-up policy per student handbook.'),
        ],
      },
    ],
  });
}

/**
 * F2 — HHSM-style value-swap (validates swap detection).
 *
 * Same shape as F1, but the "Course Title" and "Course No(s)" VALUE cells
 * are reversed (label cells stay correct). Parser must detect this via
 * `normalizeBitsCourseNumber()` failing on the Course No(s) value AND
 * succeeding on the Course Title value, then swap them.
 */
function buildHhsmSwappedDocx(): Document {
  return new Document({
    creator: 'HMP Corpus Fixture Generator',
    title: 'F2 hhsm-swap',
    sections: [
      {
        children: [
          p('Birla Institute of Technology & Science, Pilani'),
          p('Work Integrated Learning Programmes Division'),
          p('First Semester 2025-2026'),
          p('Digital Learning Handout'),
          p('Part A: Content Design'),
          labeledTable([
            // SWAPPED: title cell holds the code, code cell holds the title.
            row('Course Title', 'HHSM ZG999'),
            row('Course No(s)', 'BIOSTATISTICS & EPIDEMIOLOGY'),
            row('Credit Units', '4'),
            row('Instructor(s)', 'Dr. Test Faculty'),
            row('Date', '01-Aug-2025'),
            row('Course Description', 'Foundations of biostatistics.'),
          ]),
          p('Course Objectives'),
          labeledTable([row('Code', 'Course Objective'), row('CO1', 'Understand biostatistics')]),
          p('Text Book(s)'),
          labeledTable([
            row('Code', 'Reference'),
            row('T1', 'Rosner, Fundamentals of Biostatistics'),
          ]),
          p('Learning Outcomes'),
          labeledTable([row('Code', 'Learning Outcome'), row('LO1', 'Run a study')]),
          p('Part B: Contact Session Plan'),
          labeledTable([
            row('Contact Session', 'Topic Title', 'Sub-Topics', 'Reference'),
            row('1', 'Intro', 'Basics', 'T1'),
          ]),
          p('Evaluation Scheme'),
          labeledTable([
            row('EC No.', 'Name', 'Type', 'Weight', 'Duration'),
            row('EC-1', 'Comprehensive', 'Open Book', '100', '180m'),
          ]),
          p('elearn.bits-pilani.ac.in'),
        ],
      },
    ],
  });
}

/**
 * F3 — EE-style "Course Modules" template (validates skip-with-warning).
 *
 * Contains the `Course Modules` cell that the parser uses as the template-
 * variance flag. Parser should return `data: null, extractionMethod:
 * SKIPPED_MODULE` with a warning indicating 11f-b will address Module
 * templates. The bitsCourseNumber is still extracted from the Part A
 * header so admins can filter.
 */
function buildModuleTemplateDocx(): Document {
  return new Document({
    creator: 'HMP Corpus Fixture Generator',
    title: 'F3 module-template',
    sections: [
      {
        children: [
          p('Birla Institute of Technology & Science, Pilani'),
          p('Work Integrated Learning Programmes Division'),
          p('First Semester 2025-2026'),
          p('Digital Learning Handout'),
          p('Part A: Content Design'),
          labeledTable([
            row('Course Title', 'Environmental Chemistry'),
            row('Course No(s)', 'EE ZG999'),
          ]),
          // The template-variance flag — single cell with "Course Modules".
          p('Course Modules'),
          labeledTable([
            row('Module No', 'Module Title', 'Objectives'),
            row('1', 'Planet Earth', 'Learn the environment basics'),
            row('2', 'Chemistry of troposphere', 'Learn key reactions'),
          ]),
          p('Self-Study & Contact Session Plan'),
          labeledTable([
            row('Module Title: Planet Earth', '', ''),
            row('Topic No.', 'Topic Title', 'Reference'),
            row('1.1', 'The environment', ''),
          ]),
          p('Evaluation Scheme'),
          labeledTable([
            row('EC No.', 'Name', 'Type', 'Weight', 'Duration'),
            row('EC-1', 'Final', 'Closed', '100', '120m'),
          ]),
          p('elearn.bits-pilani.ac.in'),
        ],
      },
    ],
  });
}

/**
 * F4 — Standard with "Modular Content" section (validates drop-with-warning).
 *
 * A standard CO/LO template that ALSO has a "Modular Content Structure"
 * section. Parser should produce a Zod-valid BitsHandoutV1 (Tier 1 success)
 * AND emit a `parseWarnings` entry indicating the Modular Content section
 * was ignored. Confirms the synonym-map correction: Modular Content is NOT
 * Experiential.
 */
function buildModularContentDocx(): Document {
  return new Document({
    creator: 'HMP Corpus Fixture Generator',
    title: 'F4 modular-content',
    sections: [
      {
        children: [
          p('Birla Institute of Technology & Science, Pilani'),
          p('Work Integrated Learning Programmes Division'),
          p('First Semester 2025-2026'),
          p('Digital Learning Handout'),
          p('Part A: Content Design'),
          labeledTable([
            row('Course Title', 'Microelectromechanical Systems'),
            row('Course No(s)', 'DE ZC999'),
            row('Credit Units', '4'),
            row('Date', '01-Aug-2025'),
            row('Course Description', 'Intro to MEMS.'),
          ]),
          p('Course Objectives'),
          labeledTable([row('Code', 'Course Objective'), row('CO1', 'Understand MEMS')]),
          p('Text Book(s)'),
          labeledTable([row('Code', 'Reference'), row('T1', 'Senturia, Microsystem Design')]),
          p('Learning Outcomes'),
          labeledTable([row('Code', 'Learning Outcome'), row('LO1', 'Design a MEMS device')]),
          p('Modular Content Structure'),
          p('Overview of MEMS and Microsystems'),
          p('Introduction Microelectromechanical (MEMS) System and Microsystems'),
          p('MEMS and Micro-system Examples'),
          p('Part B: Contact Session Plan'),
          labeledTable([
            row('Contact Session', 'Topic Title', 'Sub-Topics', 'Reference'),
            row('1', 'MEMS intro', 'History; Examples', 'T1'),
          ]),
          p('Evaluation Scheme'),
          labeledTable([
            row('EC No.', 'Name', 'Type', 'Weight', 'Duration'),
            row('EC-1', 'Comprehensive', 'Open Book', '100', '180m'),
          ]),
          p('elearn.bits-pilani.ac.in'),
        ],
      },
    ],
  });
}

/**
 * F5 — Malformed (Tier 3 fail path).
 *
 * Missing required sections (no Course Title, no Course Objectives, no
 * Evaluation Scheme). Both Tier 1 (mammoth-structured) and Tier 2
 * (text-fallback) should be unable to produce a Zod-valid BitsHandoutV1.
 * Parser returns `data: null, extractionMethod: FAILED` with specific
 * errors naming the missing fields.
 */
function buildMalformedDocx(): Document {
  return new Document({
    creator: 'HMP Corpus Fixture Generator',
    title: 'F5 malformed',
    sections: [
      {
        children: [
          p('This handout is intentionally malformed for testing.'),
          p('It has no Part A header table.'),
          p('It has no Course Objectives, no Learning Outcomes, no Evaluation Scheme.'),
          p('The parser should return data: null with FAILED extraction method.'),
        ],
      },
    ],
  });
}

// ---- Run ----

const FIXTURES: Array<{ name: string; build: () => Document; description: string }> = [
  {
    name: 'f1-standard.docx',
    build: buildStandardDocx,
    description: 'Standard CO/LO template — Tier 1 happy path → MAMMOTH_STRUCTURED',
  },
  {
    name: 'f2-hhsm-swap.docx',
    build: buildHhsmSwappedDocx,
    description: 'HHSM-style Course Title / Course No(s) value swap → MAMMOTH_STRUCTURED via swap',
  },
  {
    name: 'f3-module-template.docx',
    build: buildModuleTemplateDocx,
    description: 'EE-style "Course Modules" template → SKIPPED_MODULE',
  },
  {
    name: 'f4-modular-content.docx',
    build: buildModularContentDocx,
    description: 'Standard + "Modular Content Structure" → MAMMOTH_STRUCTURED with parseWarnings',
  },
  {
    name: 'f5-malformed.docx',
    build: buildMalformedDocx,
    description: 'Missing required sections → FAILED',
  },
];

async function main() {
  const outDir = join(
    import.meta.dirname ?? __dirname,
    '..',
    'src',
    '__fixtures__',
    'corpus-samples',
  );
  await mkdir(outDir, { recursive: true });
  for (const f of FIXTURES) {
    const buf = await Packer.toBuffer(f.build());
    const out = join(outDir, f.name);
    await writeFile(out, buf);
    console.log(`✓ ${f.name} (${buf.length.toLocaleString()} bytes) — ${f.description}`);
  }
  console.log(`\nWrote ${FIXTURES.length} fixtures to ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

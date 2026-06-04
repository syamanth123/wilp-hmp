import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocxFile, parseDocxToHandout, type ParseResult } from '../corpus-import/parser';
import { BitsHandoutSchemaV1 } from '../handout-schema';

const fixturesDir = join(__dirname, '..', '__fixtures__', 'corpus-samples');

function fixture(name: string): string {
  return join(fixturesDir, name);
}

const F1 = fixture('f1-standard.docx');
const F2 = fixture('f2-hhsm-swap.docx');
const F3 = fixture('f3-module-template.docx');
const F4 = fixture('f4-modular-content.docx');
const F5 = fixture('f5-malformed.docx');
const F6 = fixture('f6-real-corpus-shape.docx');
const F7 = fixture('f7-narrative-prose.docx');
const F8 = fixture('f8-real-eval-and-partb.docx');

// Guard: if the fixtures haven't been generated (e.g. fresh checkout without
// the post-install run), the whole suite probe-skips with a helpful message
// rather than failing per-test.
const ready = [F1, F2, F3, F4, F5, F6, F7, F8].every(existsSync);
const itIfReady = ready ? it : it.skip;

if (!ready) {
  console.warn(
    '[corpus-parser.test] Fixtures missing. Run `pnpm --filter @hmp/db fixture:generate` to produce them.',
  );
}

describe('corpus parser — Tier 1 standard template (F1)', () => {
  let r: ParseResult;
  itIfReady('parses F1 to MAMMOTH_STRUCTURED with Zod-valid data', async () => {
    r = await parseDocxFile(F1);
    expect(r.extractionMethod).toBe('MAMMOTH_STRUCTURED');
    expect(r.data).not.toBeNull();
    expect(BitsHandoutSchemaV1.safeParse(r.data).success).toBe(true);
  });

  itIfReady('extracts SE ZG501 as the course number, no alternateCodes', async () => {
    r = await parseDocxFile(F1);
    expect(r.bitsCourseNumber).toBe('SE ZG501');
    expect(r.alternateCodes).toEqual([]);
  });

  itIfReady('populates Part A scalars from the header table', async () => {
    r = await parseDocxFile(F1);
    expect(r.data!.partA.courseTitle).toBe('Software Quality Assurance');
    expect(r.data!.partA.courseNumbers).toEqual(['SE ZG501']);
    expect(r.data!.partA.instructors).toEqual(['Dr. Test Faculty']);
    expect(r.data!.partA.creditModel?.description).toBe('3');
  });

  itIfReady('populates CO/LO/T-books from labeled tables', async () => {
    r = await parseDocxFile(F1);
    expect(r.data!.partA.courseObjectives.map((c) => c.code)).toEqual(['CO1', 'CO2']);
    expect(r.data!.partA.learningOutcomes.map((c) => c.code)).toEqual(['LO1', 'LO2']);
    expect(r.data!.partA.textBooks.map((c) => c.code)).toEqual(['T1']);
    expect(r.data!.partA.referenceBooks.map((c) => c.code)).toEqual(['R1']);
  });

  itIfReady('parses Part B sessions including sub-topic ";" join contract', async () => {
    r = await parseDocxFile(F1);
    expect(r.data!.partB.sessions).toHaveLength(2);
    expect(r.data!.partB.sessions[0]!.subTopics).toBe('History; Standards');
    expect(r.data!.partB.sessions[0]!.references).toEqual(['T1 Ch. 1']);
  });

  itIfReady(
    'parses evaluation EC components with sub-component weights summing to 100',
    async () => {
      r = await parseDocxFile(F1);
      const total = r.data!.evaluation.components.reduce(
        (s, ec) => s + ec.subComponents.reduce((ss, sc) => ss + sc.weight, 0),
        0,
      );
      expect(total).toBe(100);
      expect(r.data!.evaluation.components.map((c) => c.ecNumber)).toEqual([
        'EC-1',
        'EC-2',
        'EC-3',
      ]);
    },
  );

  itIfReady('emits no warnings or errors for the clean happy-path fixture', async () => {
    r = await parseDocxFile(F1);
    expect(r.warnings).toEqual([]);
    expect(r.errors).toEqual([]);
  });
});

describe('corpus parser — Tier 1 HHSM value-swap (F2)', () => {
  itIfReady('detects the swap and recovers the correct course number', async () => {
    const r = await parseDocxFile(F2);
    expect(r.extractionMethod).toBe('MAMMOTH_STRUCTURED');
    expect(r.bitsCourseNumber).toBe('HHSM ZG999');
    expect(r.data!.partA.courseTitle).toBe('BIOSTATISTICS & EPIDEMIOLOGY');
  });

  itIfReady(
    'emits a warning explaining the swap so admins know the source had this irregularity',
    async () => {
      const r = await parseDocxFile(F2);
      expect(r.warnings.some((w) => /HHSM-style value swap/i.test(w))).toBe(true);
    },
  );
});

describe('corpus parser — Module template (F3) — 11f-b2 honest-empty mapping', () => {
  // 11f-b2 replaces 11f-b1's SKIPPED_MODULE behavior. Module templates now
  // produce MAMMOTH_STRUCTURED with empty CO/LO arrays (schema relaxed in
  // 11f-b2) + populated partB from Self-Study Plan + parseWarnings naming
  // the Module source. Faculty editing a Module import sees populated Part
  // A + Part B sessions, with submit-time validation enforcing CO/LO
  // presence before submission.

  itIfReady('returns MAMMOTH_STRUCTURED with data (not SKIPPED_MODULE)', async () => {
    const r = await parseDocxFile(F3);
    expect(r.extractionMethod).toBe('MAMMOTH_STRUCTURED');
    expect(r.data).not.toBeNull();
  });

  itIfReady('extracts the course number from the Module-template Part A header', async () => {
    const r = await parseDocxFile(F3);
    expect(r.bitsCourseNumber).toBe('EE ZG999');
  });

  itIfReady(
    'emits honest-empty CO/LO arrays with parseWarnings naming the source gap',
    async () => {
      const r = await parseDocxFile(F3);
      expect(r.data!.partA.courseObjectives).toEqual([]);
      expect(r.data!.partA.learningOutcomes).toEqual([]);
      expect(
        r.warnings.some(
          (w) => /per-module Objectives/i.test(w) && /must be added by faculty/i.test(w),
        ),
      ).toBe(true);
      expect(r.warnings.some((w) => /Learning Outcomes not present/i.test(w))).toBe(true);
    },
  );
});

describe('corpus parser — Modular Content drop-with-warning (F4)', () => {
  itIfReady(
    'returns MAMMOTH_STRUCTURED with valid data despite the Modular Content section',
    async () => {
      const r = await parseDocxFile(F4);
      expect(r.extractionMethod).toBe('MAMMOTH_STRUCTURED');
      expect(r.data).not.toBeNull();
      expect(r.bitsCourseNumber).toBe('DE ZC999');
    },
  );

  itIfReady(
    'emits the "Modular Content section ignored" warning (synonym-map correction)',
    async () => {
      const r = await parseDocxFile(F4);
      expect(r.warnings.some((w) => /Modular Content section ignored/i.test(w))).toBe(true);
    },
  );
});

describe('corpus parser — Tier 3 FAILED (F5)', () => {
  itIfReady('returns FAILED with data: null and a specific error', async () => {
    const r = await parseDocxFile(F5);
    expect(r.extractionMethod).toBe('FAILED');
    expect(r.data).toBeNull();
    expect(r.errors.some((e) => /Part A header table not found/i.test(e))).toBe(true);
  });

  itIfReady('text-fallback finds no normalizable course number', async () => {
    const r = await parseDocxFile(F5);
    expect(r.bitsCourseNumber).toBeNull();
  });
});

describe('corpus parser — Tier 1 real-corpus shape (F6) — 11f-b1 correctness fix', () => {
  // F6 mimics the AEL ZG631 golden shape that 11f-a's parser missed:
  // - CO header "No | Course Objective" (not "Code | ...")
  // - T/R tables with NO header row (data rows only)
  // - LO label with ": Students will be able to" suffix
  // - Course Description as <p><strong>...</strong>prose</p>, not in Part A table

  itIfReady(
    'returns MAMMOTH_STRUCTURED with full content extracted (no placeholder warnings)',
    async () => {
      const r = await parseDocxFile(F6);
      expect(r.extractionMethod).toBe('MAMMOTH_STRUCTURED');
      expect(r.data).not.toBeNull();
      expect(r.warnings).toEqual([]);
    },
  );

  itIfReady('extracts CO codes from a "No | Course Objective" header (not "Code")', async () => {
    const r = await parseDocxFile(F6);
    expect(r.data!.partA.courseObjectives.map((c) => c.code)).toEqual(['CO1', 'CO2']);
    expect(r.data!.partA.courseObjectives[0]!.description).toContain('No');
  });

  itIfReady('extracts T-book rows from a no-header table (data-row-only)', async () => {
    const r = await parseDocxFile(F6);
    expect(r.data!.partA.textBooks.map((c) => c.code)).toEqual(['T1', 'T2']);
    expect(r.data!.partA.textBooks[0]!.citation).toContain('Real Corpus Authority, Vol 1');
  });

  itIfReady('extracts R-book rows from a no-header table', async () => {
    const r = await parseDocxFile(F6);
    expect(r.data!.partA.referenceBooks.map((c) => c.code)).toEqual(['R1']);
  });

  itIfReady(
    'extracts LO codes when the label has the "Students will be able to" suffix',
    async () => {
      const r = await parseDocxFile(F6);
      expect(r.data!.partA.learningOutcomes.map((c) => c.code)).toEqual(['LO1', 'LO2']);
    },
  );

  itIfReady(
    'extracts Course Description from the <p>Course Description: prose</p> paragraph form',
    async () => {
      const r = await parseDocxFile(F6);
      expect(r.data!.partA.courseDescription).toContain('real-corpus structure');
      expect(r.data!.partA.courseDescription).toContain('AEL ZG631');
    },
  );
});

describe('corpus parser — narrative-prose template (F7) — 11f-b1', () => {
  // Survey B finding: 5 corpus files use a "narrative-prose" template with
  // colon-separated Part A lines and un-tabled text books. Out of scope for
  // 11f-b1; parser returns SKIPPED_NARRATIVE_PROSE with the course number.

  itIfReady('returns SKIPPED_NARRATIVE_PROSE with data: null', async () => {
    const r = await parseDocxFile(F7);
    expect(r.extractionMethod).toBe('SKIPPED_NARRATIVE_PROSE');
    expect(r.data).toBeNull();
  });

  itIfReady('extracts the course number from the colon-prose line', async () => {
    const r = await parseDocxFile(F7);
    expect(r.bitsCourseNumber).toBe('NP ZG999');
  });

  itIfReady('emits a warning naming the template as out-of-scope', async () => {
    const r = await parseDocxFile(F7);
    expect(r.warnings.some((w) => /Narrative-prose template/i.test(w))).toBe(true);
  });
});

describe('corpus parser — real-corpus Eval/PartB header variants (F8) — 11f-b2', () => {
  // Survey D revealed two further real-corpus shapes 11f-b1's parser
  // missed: Part B header "Contact Hour | List of Topic | Sub-Topics | ..."
  // (AEL_ZG554 family) and Evaluation header "No | Name | Type | Duration |
  // Weight | ..." (most of the corpus — column order Duration-before-Weight).
  // F8 was designed AFTER inspecting actual mammoth output from real corpus,
  // per the 11f-b1 fixture-vs-real convention.

  itIfReady(
    'returns MAMMOTH_STRUCTURED with full content (no eval/partB placeholder warnings)',
    async () => {
      const r = await parseDocxFile(F8);
      expect(r.extractionMethod).toBe('MAMMOTH_STRUCTURED');
      expect(r.data).not.toBeNull();
      expect(r.warnings.some((w) => /Part B sessions missing/i.test(w))).toBe(false);
      expect(r.warnings.some((w) => /Evaluation Scheme missing/i.test(w))).toBe(false);
    },
  );

  itIfReady('parses Part B from "Contact Hour" header (not "Contact Session")', async () => {
    const r = await parseDocxFile(F8);
    expect(r.data!.partB.sessions).toHaveLength(2);
    expect(r.data!.partB.sessions[0]!.sessionNumber).toBe('1');
    expect(r.data!.partB.sessions[0]!.topicTitle).toBe('Real-corpus header detection');
  });

  itIfReady('parses Evaluation with "No" col0 + Duration-before-Weight column order', async () => {
    const r = await parseDocxFile(F8);
    const total = r.data!.evaluation.components.reduce(
      (s, ec) => s + ec.subComponents.reduce((ss, sc) => ss + sc.weight, 0),
      0,
    );
    expect(total).toBe(100);
    expect(r.data!.evaluation.components.map((c) => c.ecNumber)).toEqual(['EC-1', 'EC-2', 'EC-3']);
    // EC-1 sub-component weight should be 20 (column-position detection
    // correctly reads "Weight" column despite Duration appearing before it).
    expect(r.data!.evaluation.components[0]!.subComponents[0]!.weight).toBe(20);
    expect(r.data!.evaluation.components[0]!.subComponents[0]!.duration).toBe('30m');
  });
});

describe('corpus parser — pre-flight skips', () => {
  itIfReady('SKIPPED_FORMAT for .doc files', async () => {
    const r = await parseDocxToHandout({
      filePath: '/tmp/fake-legacy.doc',
      fileBytes: 50_000,
    });
    expect(r.extractionMethod).toBe('SKIPPED_FORMAT');
    expect(r.data).toBeNull();
  });

  itIfReady('SKIPPED_FORMAT for .pdf files', async () => {
    const r = await parseDocxToHandout({
      filePath: '/tmp/fake.pdf',
      fileBytes: 50_000,
    });
    expect(r.extractionMethod).toBe('SKIPPED_FORMAT');
  });

  itIfReady('SKIPPED_SIZE for files over the size cap', async () => {
    const r = await parseDocxToHandout({
      filePath: F1,
      fileBytes: 10 * 1024 * 1024,
      maxBytes: 3 * 1024 * 1024,
    });
    expect(r.extractionMethod).toBe('SKIPPED_SIZE');
    expect(r.errors[0]).toContain('exceeds');
  });
});

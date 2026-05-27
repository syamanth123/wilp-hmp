import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import AdmZip from 'adm-zip';

/**
 * BITS handout corpus — structural-presence sweep (slow, env-gated, probe-skip).
 *
 * Walks a directory of REAL BITS handout `.docx` files and asserts that the
 * overwhelming majority contain every section `BitsHandoutSchemaV1` requires.
 *
 * This is a STRUCTURAL PROXY, not a true schema parse. There is no
 * docx → structured-object parser yet (that lands in Prompt 11f); until then we
 * can only check that the required *sections* are present in the flattened
 * document text, which is the best available signal that a faithful parser
 * would be able to populate the required fields. When 11f lands, this test
 * should be upgraded to `BitsHandoutSchemaV1.safeParse(parse(docx))`.
 *
 * The corpus is BITS intellectual property: it is gitignored and never ships in
 * the repo. The test therefore PROBE-SKIPS unless `HMP_CORPUS_DIR` points at a
 * directory that actually contains `.docx` files — the same probe-skip
 * convention used for MinIO / Mailhog / Redis integration suites
 * (docs/dev-handoff-audit.md §4). It runs only where the corpus is mounted (a
 * maintainer's machine), never in CI.
 *
 *   HMP_CORPUS_DIR="/path/to/corpus" pnpm --filter @hmp/db test
 */

const CORPUS_DIR = process.env.HMP_CORPUS_DIR;
// Threshold is 85% — calibrated to the PROXY parser's structural ceiling (regex
// over flattened XML), NOT the schema's correctness. The schema fits 100% of
// corpus content that the proxy can extract; the ~12% gap is the parser's
// (tables/text-boxes, run-split text, section-label synonyms — diagnosed in
// docs/dev-handoff-audit.md §5 "Known parser challenges for Prompt 11f"), not a
// schema gap. Prompt 11f's deliverable includes raising this threshold to 95%
// with the mammoth-based structured parser. Until then the test's job is
// REGRESSION DETECTION (a NEW consistent miss across many files = a real
// regression), not quality enforcement.
const PASS_THRESHOLD = 0.85;
// Image-heavy outliers (scanned tables, embedded pictures) defeat a naive
// tag-strip; they are 11f's structure-aware-extraction problem, not this
// sweep's. Skip them so they don't drag down a rate that's about field coverage.
const MAX_BYTES = 3 * 1024 * 1024;

// Required-section probes (label + regex over the flattened document text).
// NOTE: "Experiential Learning" is intentionally ABSENT from this list — it
// became OPTIONAL in the schema once the corpus showed a genuine theory course
// (CC ZG501) with no experiential section at all. Only sections backing a
// *required* field are probed here.
const REQUIRED_SECTIONS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: 'courseTitle', pattern: /Course Title/i },
  { label: 'courseNo', pattern: /Course No/i },
  { label: 'courseObjectives', pattern: /Course Objective|CO\d/i },
  { label: 'textBooks', pattern: /Text ?Book|Books Recommended/i },
  { label: 'learningOutcomes', pattern: /Learning Outcome|LO\d/i },
  { label: 'evaluation', pattern: /Evaluation Scheme|Evaluation Component|EC ?-? ?\d/i },
  { label: 'elearnUrl', pattern: /elearn\.bits-pilani/i },
];

function listDocx(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.docx') && !f.startsWith('~$'))
    .map((f) => join(dir, f));
}

/** Flatten word/document.xml to plain text (same approach as the manual sweep). */
function extractText(file: string): string | null {
  try {
    const entry = new AdmZip(file).getEntry('word/document.xml');
    if (!entry) return null;
    return entry
      .getData()
      .toString('utf8')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ');
  } catch {
    return null; // corrupt / legacy .doc renamed to .docx — counted as "not extractable"
  }
}

const corpusReady = !!CORPUS_DIR && existsSync(CORPUS_DIR) && listDocx(CORPUS_DIR).length > 0;

describe.skipIf(!corpusReady)(
  'BITS handout corpus — structural-presence sweep (slow, env-gated)',
  () => {
    it(`>= ${PASS_THRESHOLD * 100}% of corpus handouts contain every required section`, () => {
      const files = listDocx(CORPUS_DIR!);
      let scanned = 0;
      let pass = 0;
      const missByLabel: Record<string, number> = {};
      const failures: string[] = [];

      for (const file of files) {
        if (statSync(file).size > MAX_BYTES) continue;
        const text = extractText(file);
        if (!text) continue;
        scanned += 1;
        const missing = REQUIRED_SECTIONS.filter((s) => !s.pattern.test(text)).map((s) => s.label);
        if (missing.length === 0) {
          pass += 1;
        } else {
          failures.push(`${basename(file)} — missing: ${missing.join(', ')}`);
          for (const m of missing) missByLabel[m] = (missByLabel[m] ?? 0) + 1;
        }
      }

      expect(scanned, 'no extractable .docx found in HMP_CORPUS_DIR').toBeGreaterThan(0);

      const rate = pass / scanned;
      // On failure, surface the diagnostics that distinguish a real schema gap
      // (one section missing consistently → revisit the schema) from scattered
      // extraction outliers (→ 11f structure-aware extraction, not a schema bug).
      expect(
        rate,
        `structural pass rate ${(rate * 100).toFixed(1)}% (${pass}/${scanned}) is below ` +
          `${PASS_THRESHOLD * 100}%.\nPer-section miss counts: ${JSON.stringify(missByLabel)}\n` +
          `Sample failures:\n${failures.slice(0, 15).join('\n')}`,
      ).toBeGreaterThanOrEqual(PASS_THRESHOLD);
    });
  },
);

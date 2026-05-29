import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import AdmZip from 'adm-zip';
import { normalizeBitsCourseNumber } from '../course-code';

/**
 * BITS course-code corpus sweep (slow, env-gated, probe-skip).
 *
 * Walks the gitignored handout corpus and asserts that the overwhelming
 * majority of handouts yield AT LEAST one `Course No(s)` value that the
 * Prompt 11b normalizer accepts.
 *
 * This is a STRUCTURAL PROXY for "would the 11f parser populate
 * `Course.bitsCourseNumber` successfully?" — it inherits the same proxy
 * extractor as the 11a sweep (unzip → flatten tags → regex) and therefore the
 * same documented ceiling (tables / run-splits / HHSM table-layout variance,
 * see docs/dev-handoff-audit.md §5 "Known parser challenges for Prompt 11f").
 * When 11f's mammoth-based parser replaces the proxy, raise the threshold.
 *
 * The corpus is BITS IP, gitignored, and never ships in the repo. The test
 * PROBE-SKIPS unless `HMP_CORPUS_DIR` points at a directory of `.docx` files
 * (mirrors the 11a corpus sweep). Runs only on a maintainer's machine; never
 * in CI.
 */

const CORPUS_DIR = process.env.HMP_CORPUS_DIR;
// Threshold is **80%** — calibrated to the proxy parser's structural ceiling
// (regex over flattened XML), NOT the normalizer's correctness. Measured 85.00%
// against the 384-handout corpus at 11b time (255/300 scanned, 84 skipped as
// image-heavy outliers). Every one of the 45 failures is an extraction
// artifact: run-splitting drops or duplicates a character ("DE ZG611" → "E ZG
// 611"; "AIML ZC416" → "AIMLC ZC416"), tables hide the label (EE ZG5xx family),
// or the HHSM table-layout variance captures the title instead of the code.
// Zero are normalizer-correctness failures — the normalizer accepts 100% of
// codes the proxy CAN extract. 5-point headroom below measured catches a real
// normalizer regression. Prompt 11f's mammoth-based parser will raise this to
// 95%+. See docs/dev-handoff-audit.md §5 "Course-code corpus sweep".
const PASS_THRESHOLD = 0.8;
const MAX_BYTES = 3 * 1024 * 1024; // skip image-heavy outliers (11f parser concern)

// "Course No(s)" label + value, up to the next known terminator label.
const LABEL_RE =
  /Course\s+No\s*\(?s?\)?\s*[:.-]?\s*([^]{1,120}?)\s+(?:Credit\s+Units|Credit\s+Model|Course\s+Title|Instructor|Lead\s+Instructor|Version\s+No|Date)/i;

// BITS-code candidate regex (allows both spaced and joined forms; lets the
// normalizer decide which actually parse).
const CODE_CANDIDATE = /\b([A-Z]{1,6}\s*Z[CG]\s*\d{3,4})\b/g;

function listDocx(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.docx') && !f.startsWith('~$'))
    .map((f) => join(dir, f));
}

function extractCourseNoCandidates(file: string): string[] {
  try {
    const entry = new AdmZip(file).getEntry('word/document.xml');
    if (!entry) return [];
    const text = entry
      .getData()
      .toString('utf8')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ');
    const labelMatch = text.match(LABEL_RE);
    if (!labelMatch) return [];
    const captured = labelMatch[1] ?? '';
    return Array.from(captured.matchAll(CODE_CANDIDATE)).map((m) => m[1] ?? '');
  } catch {
    return [];
  }
}

const corpusReady = !!CORPUS_DIR && existsSync(CORPUS_DIR) && listDocx(CORPUS_DIR).length > 0;

describe.skipIf(!corpusReady)(
  'BITS course-code corpus sweep — Prompt 11b normalizer (slow, env-gated)',
  () => {
    it(`>= ${PASS_THRESHOLD * 100}% of corpus handouts yield ≥1 normalizable BITS course number`, () => {
      const files = listDocx(CORPUS_DIR!);
      let scanned = 0;
      let pass = 0;
      let zeroCandidates = 0;
      let allCandidatesRejected = 0;
      const sampleFailures: string[] = [];
      const disciplineCounts: Record<string, number> = {};

      for (const file of files) {
        if (statSync(file).size > MAX_BYTES) continue;
        const candidates = extractCourseNoCandidates(file);
        scanned += 1;
        if (candidates.length === 0) {
          zeroCandidates += 1;
          if (sampleFailures.length < 12)
            sampleFailures.push(`${basename(file, '.docx')} — Course No(s) not extractable`);
          continue;
        }
        const normalized: string[] = [];
        for (const c of candidates) {
          try {
            normalized.push(normalizeBitsCourseNumber(c));
          } catch {
            /* candidate rejected — try next */
          }
        }
        if (normalized.length > 0) {
          pass += 1;
          for (const canonical of normalized) {
            const disc = canonical.split(' ')[0]!;
            disciplineCounts[disc] = (disciplineCounts[disc] ?? 0) + 1;
          }
        } else {
          allCandidatesRejected += 1;
          if (sampleFailures.length < 12)
            sampleFailures.push(
              `${basename(file, '.docx')} — none-normalized: ${candidates.join(', ')}`,
            );
        }
      }

      expect(scanned, 'no extractable .docx found in HMP_CORPUS_DIR').toBeGreaterThan(0);
      const rate = pass / scanned;
      // On failure, the diagnostics distinguish a real normalizer regression
      // (a consistent miss across many disciplines = the regex tightened too far)
      // from extraction artifacts (scattered, 11f parser concern).
      expect(
        rate,
        `course-code corpus pass rate ${(rate * 100).toFixed(1)}% (${pass}/${scanned}) ` +
          `below ${PASS_THRESHOLD * 100}%.\nCategories: zeroCandidates=${zeroCandidates}, ` +
          `allRejected=${allCandidatesRejected}\nDiscipline counts: ${JSON.stringify(disciplineCounts)}\n` +
          `Sample failures:\n${sampleFailures.join('\n')}`,
      ).toBeGreaterThanOrEqual(PASS_THRESHOLD);
    });
  },
);

/**
 * Real-corpus dry run for Prompt 11f-a verification. Pipes per-file progress
 * to stdout and prints the final breakdown. Reads the corpus path from
 * `HMP_CORPUS_DIR` so the script is portable across machines.
 *
 *   $env:HMP_CORPUS_DIR = "...path..."; pnpm --filter @hmp/db exec tsx scripts/run-corpus-import.ts
 *
 * The script is committed for reproducibility. It's NOT wired into CI — the
 * corpus is BITS IP and gitignored; CI runs the synthetic-fixture
 * integration test instead.
 */

import { PrismaClient } from '@prisma/client';
import { runCorpusImport } from '../src/corpus-import/import-action';

const corpusPath = process.env.HMP_CORPUS_DIR;
if (!corpusPath) {
  console.error('Set HMP_CORPUS_DIR to the corpus directory before running.');
  process.exit(2);
}

async function main() {
  const prisma = new PrismaClient();

  const methodCounts: Record<string, number> = {};

  const summary = await runCorpusImport(prisma, corpusPath, {
    onProgress: (file, method) => {
      methodCounts[method] = (methodCounts[method] ?? 0) + 1;
      const lineN = Object.values(methodCounts).reduce((a, b) => a + b, 0);
      if (lineN % 25 === 0) {
        const parts = Object.entries(methodCounts)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([m, n]) => `${m}=${n}`)
          .join(' ');
        console.log(`  [${lineN}] ${parts}`);
      }
    },
  });

  console.log('');
  console.log('=== Corpus import summary ===');
  console.log(`scanned:          ${summary.scanned}`);
  console.log(
    `succeeded:        ${summary.succeeded}  (MAMMOTH_STRUCTURED + TEXT_FALLBACK with data)`,
  );
  console.log(`failed:           ${summary.failed}`);
  console.log(`skippedModule:    ${summary.skippedModule}  (EE-style Course Modules template)`);
  console.log(`skippedSize:      ${summary.skippedSize}    (>3MB image-heavy)`);
  console.log(`skippedFormat:    ${summary.skippedFormat}  (.doc / .pdf)`);
  console.log(
    `unchanged:        ${summary.unchanged}      (idempotent — bytes+mtime match prior row)`,
  );
  console.log(
    `durationMs:       ${summary.durationMs}    (${(summary.durationMs / 1000).toFixed(1)}s)`,
  );
  console.log('');

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

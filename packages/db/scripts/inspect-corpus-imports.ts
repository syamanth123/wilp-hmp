/**
 * Diagnostic: inspect the imported HandoutImport rows. Ad-hoc script kept
 * for reproducibility of the 11f-a verification snapshot.
 */

import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  const byMethod = await prisma.handoutImport.groupBy({
    by: ['extractionMethod'],
    _count: true,
  });
  console.log('--- counts by method ---');
  for (const r of byMethod) {
    console.log(`  ${r.extractionMethod.padEnd(22)} ${r._count}`);
  }
  console.log('');

  console.log('--- SKIPPED_MODULE files (should be EE family per the survey) ---');
  const modules = await prisma.handoutImport.findMany({
    where: { extractionMethod: 'SKIPPED_MODULE' },
    select: { sourceFile: true, bitsCourseNumber: true },
    orderBy: { sourceFile: 'asc' },
  });
  for (const m of modules) {
    const base = m.sourceFile.split(/[\\/]/).pop();
    console.log(`  ${(m.bitsCourseNumber ?? '?').padEnd(12)} ${base}`);
  }
  console.log('');

  console.log('--- FAILED files (first 15, with first parseError) ---');
  const failed = await prisma.handoutImport.findMany({
    where: { extractionMethod: 'FAILED' },
    select: { sourceFile: true, bitsCourseNumber: true, parseErrors: true },
    orderBy: { sourceFile: 'asc' },
    take: 15,
  });
  for (const f of failed) {
    const base = f.sourceFile.split(/[\\/]/).pop();
    console.log(`  ${(f.bitsCourseNumber ?? '?').padEnd(15)} ${base}`);
    if (f.parseErrors[0]) console.log(`    → ${f.parseErrors[0].slice(0, 120)}`);
  }
  console.log('');

  console.log('--- MAMMOTH_STRUCTURED files with HHSM-style swap warnings ---');
  const swaps = await prisma.handoutImport.findMany({
    where: { parseWarnings: { hasSome: ['HHSM-style value swap detected'] } },
    select: { sourceFile: true, bitsCourseNumber: true },
    take: 20,
  });
  // hasSome with a literal string substring isn't quite right; do a broader filter
  const allMammoth = await prisma.handoutImport.findMany({
    where: { extractionMethod: 'MAMMOTH_STRUCTURED' },
    select: { sourceFile: true, bitsCourseNumber: true, parseWarnings: true },
  });
  const realSwaps = allMammoth.filter((r) =>
    r.parseWarnings.some((w) => /HHSM-style value swap/i.test(w)),
  );
  console.log(`  total with swap warning: ${realSwaps.length}`);
  for (const s of realSwaps.slice(0, 10)) {
    const base = s.sourceFile.split(/[\\/]/).pop();
    console.log(`  ${(s.bitsCourseNumber ?? '?').padEnd(12)} ${base}`);
  }
  console.log('');

  console.log('--- MAMMOTH_STRUCTURED files with Modular Content warning ---');
  const modularContent = allMammoth.filter((r) =>
    r.parseWarnings.some((w) => /Modular Content section ignored/i.test(w)),
  );
  console.log(`  total with Modular Content warning: ${modularContent.length}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

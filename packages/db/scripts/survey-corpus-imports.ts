/**
 * Survey C — read-only profiling of HandoutImport rows for the 11f-b
 * approval-workflow UX design. No writes; pure SELECT.
 */

import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();

  const total = await prisma.handoutImport.count();
  console.log(`Total HandoutImport rows: ${total}`);
  console.log('');

  const byMethod = await prisma.handoutImport.groupBy({
    by: ['extractionMethod'],
    _count: true,
  });
  console.log('--- by extractionMethod ---');
  for (const r of byMethod.sort((a, b) => b._count - a._count)) {
    console.log(`  ${r.extractionMethod.padEnd(22)} ${r._count}`);
  }
  console.log('');

  // 1. Distribution of parseWarnings count
  const mammoth = await prisma.handoutImport.findMany({
    where: { extractionMethod: 'MAMMOTH_STRUCTURED' },
    select: { id: true, bitsCourseNumber: true, parseWarnings: true, sourceFileBytes: true },
  });

  let zeroWarns = 0;
  let oneWarn = 0;
  let twoToFive = 0;
  let sixPlus = 0;
  for (const r of mammoth) {
    const n = r.parseWarnings.length;
    if (n === 0) zeroWarns++;
    else if (n === 1) oneWarn++;
    else if (n <= 5) twoToFive++;
    else sixPlus++;
  }
  console.log('--- MAMMOTH_STRUCTURED rows by parseWarnings count ---');
  console.log(`  0 warnings (high-confidence):           ${zeroWarns}`);
  console.log(`  1 warning:                              ${oneWarn}`);
  console.log(`  2-5 warnings:                           ${twoToFive}`);
  console.log(`  6+ warnings (heavily degraded):         ${sixPlus}`);
  console.log('');

  // 2. Top 10 most-common warning patterns
  const warningCounts = new Map<string, number>();
  for (const r of mammoth) {
    for (const w of r.parseWarnings) {
      // Normalize each warning to its leading clause (strip dynamic details).
      const key = w.split(/[—:.]/, 1)[0]?.trim().slice(0, 80) ?? w;
      warningCounts.set(key, (warningCounts.get(key) ?? 0) + 1);
    }
  }
  console.log('--- Top warning patterns ---');
  for (const [w, n] of [...warningCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`  ${n.toString().padStart(4)} ${w}`);
  }
  console.log('');

  // 3. Discipline distribution among MAMMOTH_STRUCTURED
  const disciplineCounts = new Map<string, number>();
  for (const r of mammoth) {
    if (!r.bitsCourseNumber) continue;
    const d = r.bitsCourseNumber.split(' ')[0] ?? '?';
    disciplineCounts.set(d, (disciplineCounts.get(d) ?? 0) + 1);
  }
  console.log('--- MAMMOTH_STRUCTURED disciplines (top 15) ---');
  for (const [d, n] of [...disciplineCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`  ${d.padEnd(10)} ${n}`);
  }
  console.log('');

  // 4. Course-row reconciliation — how many imports map to an existing Course?
  const allCourseNumbers = new Set<string>();
  for (const r of mammoth) {
    if (r.bitsCourseNumber) allCourseNumbers.add(r.bitsCourseNumber);
  }
  const courses = await prisma.course.findMany({
    where: {
      OR: [
        { bitsCourseNumber: { in: [...allCourseNumbers] } },
        { alternateCodes: { hasSome: [...allCourseNumbers] } },
      ],
    },
    select: { bitsCourseNumber: true, alternateCodes: true },
  });
  console.log('--- Course-row reconciliation ---');
  console.log(`  Unique course numbers in imports:       ${allCourseNumbers.size}`);
  console.log(`  Course rows matching (canonical or alt): ${courses.length}`);
  const unreconciled = allCourseNumbers.size - courses.length;
  console.log(`  Imports w/o matching Course row:        ~${unreconciled}`);
  console.log('');

  // 5. File-size distribution
  const sizes = mammoth.map((r) => r.sourceFileBytes).sort((a, b) => a - b);
  const median = sizes[Math.floor(sizes.length / 2)] ?? 0;
  console.log('--- MAMMOTH_STRUCTURED file-size distribution ---');
  console.log(`  median: ${(median / 1024).toFixed(0)} KB`);
  console.log(`  min:    ${(sizes[0]! / 1024).toFixed(0)} KB`);
  console.log(`  max:    ${(sizes.at(-1)! / 1024).toFixed(0)} KB`);
  const lt50 = sizes.filter((s) => s < 50_000).length;
  console.log(`  files <50 KB (skeleton/incomplete?):    ${lt50}`);
  console.log('');

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

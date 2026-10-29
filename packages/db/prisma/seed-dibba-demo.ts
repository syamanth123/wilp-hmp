import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import bcrypt from 'bcryptjs';
import { PrismaClient, RoleName, type FacultyType } from '@prisma/client';
import { assertDevOnly } from './seed-scaffolding';
import { ensureDocxFormat } from '../src/corpus-import';
import {
  createDibbaImport,
  publishDibbaImport,
  parseDibbaDocx,
  parseFacultySheetDetailed,
  importFacultySheet,
  updateAcademicTerm,
  updateSlotTimings,
  upsertSlotExamDates,
  type ExamDateInput,
} from '../src/dibba-import';
import { loadTermOverview } from '../src/dibba-schedule/overview';

/**
 * DEV-ONLY demo data for the Course Dibba feature (Stage E of the manager-demo
 * mandate). Loads the REAL files from the gitignored local-data/ folder into
 * the LOCAL database:
 *
 *   1. the 2025 Course Dibba (.doc via LibreOffice, else the committed .docx
 *      fixture) → one PUBLISHED import for the dev term "2026-27 Sem 1 (demo, 2025-26 Dibba)";
 *   2. the 2024 workbook's Sheet3 → local FACULTY users for every email
 *      (password "password"), then the faculty-sheet import;
 *   3. sample class times and exam dates; the term's dates are moved to span
 *      today so "next class / next exam" has something to show;
 *   4. prints three faculty logins with rich schedules (one with a clash).
 *
 * assertDevOnly() refuses to run in production. The files never leave the
 * laptop; nothing here is reachable from the app.
 *
 *   pnpm --filter @hmp/db seed:dibba-demo
 *   SOFFICE_BIN="C:\Program Files\LibreOffice\program\soffice.exe" pnpm --filter @hmp/db seed:dibba-demo
 */

const prisma = new PrismaClient();
const ROOT = resolve(__dirname, '..', '..', '..');
const LOCAL_DOC = join(ROOT, 'local-data', 'course-dibba-2025-s1.doc');
const LOCAL_XLSX = join(ROOT, 'local-data', 'course-dibba-2024.xlsx');
const FIXTURE_DOCX = join(
  __dirname,
  '..',
  'src',
  '__fixtures__',
  'dibba',
  'course-dibba-2025-s1.docx',
);
const TERM_NAME = '2026-27 Sem 1 (demo, 2025-26 Dibba)';
/** Name used by older dev seeds; still accepted. */
const OLD_TERM_NAME = '2025-26 Sem 1';
const IMPORT_LABEL = 'Demo: As on 02.07.2025';

const addDays = (d: Date, n: number): Date => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const nextWeekday = (from: Date, weekday: number): Date => {
  const d = new Date(from);
  d.setDate(d.getDate() + ((weekday - d.getDay() + 7) % 7));
  return d;
};
const campusToType = (campus: string | null): FacultyType | null => {
  if (!campus) return null;
  if (/off/i.test(campus)) return 'OFF_CAMPUS';
  if (/on|pilani|hyd|goa|dubai|campus/i.test(campus)) return 'ON_CAMPUS';
  return null;
};

async function main() {
  assertDevOnly();
  // Both inputs are checked before ANY write, so a missing file cannot leave the term half-loaded.
  if (!existsSync(LOCAL_XLSX)) {
    throw new Error(`local-data/course-dibba-2024.xlsx not found at ${LOCAL_XLSX}`);
  }
  if (!existsSync(LOCAL_DOC) && !existsSync(FIXTURE_DOCX)) {
    throw new Error(`neither ${LOCAL_DOC} nor the committed .docx fixture exists`);
  }
  const actor = await prisma.user.findUniqueOrThrow({
    where: { email: 'admin@hmp.local' },
    select: { id: true },
  });
  const facultyRole = await prisma.role.findUniqueOrThrow({
    where: { name: RoleName.FACULTY },
    select: { id: true },
  });

  // 1. Term: the seeded dev term, dated around today.
  const term =
    (await prisma.academicTerm.findUnique({ where: { name: TERM_NAME } })) ??
    (await prisma.academicTerm.findUniqueOrThrow({ where: { name: OLD_TERM_NAME } }));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startDate = addDays(today, -60);
  const endDate = addDays(today, 70);
  await updateAcademicTerm(prisma, {
    termId: term.id,
    name: term.name,
    year: term.year,
    term: term.term as 'FIRST' | 'SECOND' | 'SUMMER',
    startDate,
    endDate,
    actorId: actor.id,
  });
  console.log(
    `[demo] term "${TERM_NAME}" dated ${startDate.toDateString()} – ${endDate.toDateString()}`,
  );

  // 2. Published Dibba.
  const existing = await prisma.dibbaImport.findFirst({
    where: { termId: term.id, label: IMPORT_LABEL, status: 'PUBLISHED' },
    select: { id: true, rowCount: true },
  });
  if (existing) {
    console.log(`[demo] Dibba already published (${existing.rowCount} rows) - keeping it`);
  } else {
    let source: {
      path: string;
      format: 'doc' | 'docx';
      parsePath: string;
      cleanup?: () => Promise<void>;
    };
    if (existsSync(LOCAL_DOC)) {
      try {
        const ensured = await ensureDocxFormat(LOCAL_DOC);
        source = {
          path: LOCAL_DOC,
          format: 'doc',
          parsePath: ensured.path,
          cleanup: ensured.cleanup,
        };
        console.log('[demo] converted local-data/course-dibba-2025-s1.doc with LibreOffice');
      } catch (err) {
        console.warn(
          '[demo] LibreOffice conversion failed, falling back to the committed .docx fixture:',
          (err as Error).message,
        );
        source = { path: FIXTURE_DOCX, format: 'docx', parsePath: FIXTURE_DOCX };
      }
    } else {
      source = { path: FIXTURE_DOCX, format: 'docx', parsePath: FIXTURE_DOCX };
      console.log('[demo] local-data .doc not found, using the committed .docx fixture');
    }
    try {
      const parsed = await parseDibbaDocx({ path: source.parsePath });
      const created = await createDibbaImport(prisma, {
        termId: term.id,
        label: IMPORT_LABEL,
        sourceFilename: source.path.split(/[\\/]/).pop() ?? 'dibba',
        sourceFormat: source.format,
        uploadedById: actor.id,
        rows: parsed.rows,
        warnings: parsed.warnings,
      });
      await publishDibbaImport(prisma, { importId: created.importId, actorId: actor.id });
      console.log(
        `[demo] published ${created.rowCount} Dibba rows (${created.unknownCodeCount} codes not in the catalogue, ${created.warningCount} warnings)`,
      );
    } finally {
      await source.cleanup?.();
    }
  }

  // 3. Faculty users from Sheet3, then the sheet import.
  const sheet = await parseFacultySheetDetailed({ path: LOCAL_XLSX });
  const passwordHash = await bcrypt.hash('password', 10);
  const byEmail = new Map<string, { name: string; campus: string | null }>();
  for (const r of sheet.rows) {
    if (!r.email) continue;
    if (!byEmail.has(r.email))
      byEmail.set(r.email, { name: r.facultyName || r.email, campus: r.campus });
  }
  let createdUsers = 0;
  for (const [email, info] of byEmail) {
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        name: info.name,
        passwordHash,
        active: true,
        facultyType: campusToType(info.campus),
      },
      select: { id: true, createdAt: true },
    });
    if (Date.now() - user.createdAt.getTime() < 60_000) createdUsers += 1;
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: facultyRole.id } },
      update: {},
      create: { userId: user.id, roleId: facultyRole.id },
    });
  }
  console.log(
    `[demo] faculty users: ${byEmail.size} distinct emails in Sheet3, ${createdUsers} created now (password "password")`,
  );
  const imported = await importFacultySheet(prisma, {
    termId: term.id,
    rows: sheet.rows,
    sourceRowCount: sheet.sheetRowCount,
    actorId: actor.id,
  });
  console.log(
    `[demo] faculty sheet: ${imported.totalRows} rows, ${imported.matched} matched, ${imported.created} written, ${imported.alreadyManual} manual kept, ${imported.noEmail} without email, ${imported.unmatched.length} unmatched`,
  );

  // 4. Class times and exam dates.
  await updateSlotTimings(prisma, {
    termId: term.id,
    timings: [
      { slotNo: 1, startTime: '09:00', endTime: '12:00' },
      { slotNo: 2, startTime: '14:00', endTime: '17:00' },
      { slotNo: 3, startTime: '09:00', endTime: '12:00' },
      { slotNo: 4, startTime: '14:00', endTime: '17:00' },
      { slotNo: 5, startTime: '09:00', endTime: '12:00' },
      { slotNo: 6, startTime: '14:00', endTime: '17:00' },
      { slotNo: 7, startTime: '18:00', endTime: '20:00' },
      { slotNo: 8, startTime: '18:00', endTime: '20:00' },
    ],
    actorId: actor.id,
  });
  // Mid-sem on the two weekends after next; comprehensive on the two weekends before the term ends.
  const midSat = nextWeekday(addDays(today, 8), 6);
  const compSat = nextWeekday(addDays(endDate, -20), 6);
  const dates: ExamDateInput[] = [];
  const place = (kind: 'MID_SEM' | 'COMPREHENSIVE', sat: Date) => {
    const sun = addDays(sat, 1);
    const fri = addDays(sat, 6);
    const spec: Array<[number, Date, string, string]> = [
      [1, sat, '09:00', '12:00'],
      [2, sat, '14:00', '17:00'],
      [3, sun, '09:00', '12:00'],
      [4, sun, '14:00', '17:00'],
      [5, fri, '09:00', '12:00'],
      [6, fri, '14:00', '17:00'],
      [7, addDays(sat, 7), '18:00', '20:00'],
      [8, addDays(sun, 7), '18:00', '20:00'],
    ];
    for (const [slotNo, date, startTime, endTime] of spec)
      dates.push({ slotNo, kind, date, startTime, endTime });
  };
  place('MID_SEM', midSat);
  place('COMPREHENSIVE', compSat);
  const exams = await upsertSlotExamDates(prisma, { termId: term.id, dates, actorId: actor.id });
  console.log(
    `[demo] class times set for 8 slots; exam dates: ${exams.upserted} saved (mid-sem from ${midSat.toDateString()}, comprehensive from ${compSat.toDateString()})`,
  );

  // 5. Who to log in as.
  const overview = await loadTermOverview(prisma, { termId: term.id });
  if (!overview) throw new Error('overview unavailable');
  const clashUsers = new Set(overview.clashes.map((c) => c.userId));
  const byCourses = [...overview.faculty].sort((a, b) => b.courseCount - a.courseCount);
  const withClash = byCourses.find((f) => clashUsers.has(f.userId));
  const picks = [withClash, ...byCourses.filter((f) => f.userId !== withClash?.userId)]
    .filter(Boolean)
    .slice(0, 3);
  const users = await prisma.user.findMany({
    where: { id: { in: picks.map((p) => p!.userId) } },
    select: { id: true, email: true, name: true },
  });
  console.log('');
  console.log(
    `[demo] ${overview.courses.length} courses, ${overview.faculty.length} faculty teaching, ${overview.clashes.length} clashes, ${overview.uncovered.length} uncovered, ${overview.notInCatalogue.length} not in catalogue`,
  );
  console.log('[demo] log in as (password "password"):');
  for (const p of picks) {
    const u = users.find((x) => x.id === p!.userId);
    const clash = clashUsers.has(p!.userId) ? ' - HAS A CLASH' : '';
    console.log(
      `   ${u?.email}  (${u?.name}; ${p!.courseCount} courses: ${p!.codes.join(', ')})${clash}`,
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

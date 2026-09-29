import { PrismaClient, RoleName, FacultyType } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { normalizeBitsCourseNumber } from '../src/course-code';
import { STANDARD_SLOTS } from '../src/dibba-slots';
import { seedScaffolding, assertDevOnly } from './seed-scaffolding';

const prisma = new PrismaClient();

async function main() {
  // Hard stop if this dev seed is ever pointed at a production database — it
  // creates demo users with a default password. Production uses
  // seed.production.ts (pnpm --filter @hmp/db db:seed:prod).
  assertDevOnly();
  console.log('Seeding HMP database (dev)...');

  // --- Roles, permissions, notification templates, workflow config ---
  // Shared with the production seed via seed-scaffolding.ts (no RBAC drift).
  await seedScaffolding(prisma);
  const roleRecords = await prisma.role.findMany();
  const roleMap = new Map(roleRecords.map((r) => [r.name, r]));

  // --- Users (DEV ONLY — default password, @hmp.local demo accounts) ---
  const password = await bcrypt.hash('password', 10);
  const seededUsers: Array<{
    email: string;
    name: string;
    role: RoleName;
    facultyType?: FacultyType;
  }> = [
    { email: 'admin@hmp.local', name: 'Admin User', role: RoleName.ADMIN },
    { email: 'ic@hmp.local', name: 'Instruction Cell', role: RoleName.INSTRUCTION_CELL },
    { email: 'hog@hmp.local', name: 'Head of Group', role: RoleName.HOG },
    { email: 'pc@hmp.local', name: 'Programme Committee', role: RoleName.PROGRAMME_COMMITTEE },
    {
      email: 'faculty@hmp.local',
      name: 'On-Campus Faculty',
      role: RoleName.FACULTY,
      facultyType: FacultyType.ON_CAMPUS,
    },
    {
      email: 'faculty2@hmp.local',
      name: 'On-Campus Faculty Two',
      role: RoleName.FACULTY,
      facultyType: FacultyType.ON_CAMPUS,
    },
    {
      email: 'faculty.off@hmp.local',
      name: 'Off-Campus Faculty',
      role: RoleName.FACULTY,
      facultyType: FacultyType.OFF_CAMPUS,
    },
    {
      email: 'faculty.off2@hmp.local',
      name: 'Off-Campus Faculty Two',
      role: RoleName.FACULTY,
      facultyType: FacultyType.OFF_CAMPUS,
    },
    {
      email: 'faculty.adj@hmp.local',
      name: 'Adjunct Faculty',
      role: RoleName.FACULTY,
      facultyType: FacultyType.ADJUNCT,
    },
    {
      email: 'faculty.guest@hmp.local',
      name: 'Guest Faculty',
      role: RoleName.FACULTY,
      facultyType: FacultyType.GUEST,
    },
    { email: 'sme@hmp.local', name: 'Dr. Sneha Mehta', role: RoleName.SME },
  ];

  for (const u of seededUsers) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, facultyType: u.facultyType ?? null },
      create: {
        email: u.email,
        name: u.name,
        passwordHash: password,
        facultyType: u.facultyType ?? null,
      },
    });
    const role = roleMap.get(u.role)!;
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      update: {},
      create: { userId: user.id, roleId: role.id },
    });
  }

  // --- Academic Structure (Prompt 11b: BITS-realistic course codes) ---
  // Programmes are unchanged (existing MTECH-SE / MTECH-DS) plus a placeholder
  // MBA-WILP to host the MBA-coded courses. Programme-code reconciliation
  // against the real BITS academic system is OUT OF SCOPE for 11b — the corpus
  // carries course codes, not programme codes. See docs/dev-handoff-audit.md §1.
  // One semester window shared by the per-programme Semester rows and the
  // term-wide AcademicTerm further down, so the two can never drift in dev data.
  const SEM_I_2025_26 = { startDate: new Date('2025-08-01'), endDate: new Date('2025-12-15') };
  const programmes = [
    { code: 'MTECH-SE', name: 'M.Tech Software Engineering' },
    { code: 'MTECH-DS', name: 'M.Tech Data Science' },
    { code: 'MBA-WILP', name: 'MBA (WILP)' },
  ];
  for (const p of programmes) {
    const prog = await prisma.programme.upsert({
      where: { code: p.code },
      update: { name: p.name },
      create: p,
    });
    await prisma.semester.upsert({
      where: { programmeId_name: { programmeId: prog.id, name: 'Sem-I 2025-26' } },
      update: {},
      create: {
        programmeId: prog.id,
        name: 'Sem-I 2025-26',
        year: 2025,
        term: 'FIRST',
        ...SEM_I_2025_26,
      },
    });
  }

  // Deactivate any pre-Prompt-11b rows still holding invented codes
  // (SE-ZG501, DS-ZG501, ...). The migration backfilled their bitsCourseNumber
  // from the legacy `code`, so they don't match the canonical regex. Soft-flag
  // so existing CourseOffering rows survive (FK-safe), but they no longer
  // surface in IC dropdowns. Idempotent: a re-run flips nothing.
  const LEGACY_INVENTED_CODES = [
    'SE-ZG501',
    'SE-ZG502',
    'SE-ZG513',
    'DS-ZG501',
    'DS-ZG502',
    'DS-ZG513',
  ];
  const deactivated = await prisma.course.updateMany({
    where: { bitsCourseNumber: { in: LEGACY_INVENTED_CODES }, active: true },
    data: { active: false },
  });
  if (deactivated.count > 0) {
    console.log(`[seed] Deactivated ${deactivated.count} legacy pre-Prompt-11b Course rows.`);
  }

  // --- Course catalog (real BITS WILP codes from the 11b corpus survey) ---
  // Titles transcribed from the corpus handouts; ALLCAPS titles title-cased
  // for readability (one-way editorial transformation — same precedent as the
  // 11a subTopics decision; see docs/dev-handoff-audit.md §1).
  // CSI ZC447's three alternateCodes (ES/IS/SS) showcase BITS cross-listing
  // a single course across departments — 33% of corpus files have ≥2 codes.
  const bitsCourses: Array<{
    canonical: string;
    title: string;
    credits: number | null;
    alts: string[];
    programmeCode: string | null; // null = catalog-only (no current-semester offering)
    slot?: string;
  }> = [
    {
      canonical: 'SE ZG501',
      title: 'Software Quality Assurance and Testing',
      credits: 4,
      alts: [],
      programmeCode: 'MTECH-SE',
      slot: 'Sat-1800',
    },
    {
      canonical: 'SE ZG503',
      title: 'Full Stack Application Development',
      credits: 4,
      alts: [],
      programmeCode: 'MTECH-SE',
      slot: 'Sun-1000',
    },
    {
      canonical: 'SE ZG504',
      title: 'API Based Products',
      credits: 4,
      alts: [],
      programmeCode: 'MTECH-SE',
      slot: 'Sat-2000',
    },
    {
      canonical: 'CC ZG501',
      title: 'Introduction to Parallel and Distributed Programming',
      credits: 4,
      alts: [],
      programmeCode: 'MTECH-DS',
      slot: 'Sat-1800',
    },
    {
      canonical: 'MATH ZC222',
      title: 'Discrete Structures for Computer Science',
      credits: 4,
      alts: [],
      programmeCode: 'MTECH-DS',
      slot: 'Sun-1000',
    },
    {
      canonical: 'MBA ZC417',
      title: 'Business Statistics',
      credits: 4,
      alts: ['PDBA ZC417', 'PDFT ZC417'],
      programmeCode: 'MBA-WILP',
      slot: 'Sat-1400',
    },
    {
      canonical: 'AE ZC442',
      title: 'Advanced Driver Assistance Systems',
      credits: 4,
      alts: ['AEL ZC442'],
      programmeCode: null,
    },
    {
      canonical: 'CSI ZC447',
      title: 'Data Storage Technology and Networks',
      credits: 4,
      alts: ['ES ZC447', 'IS ZC447', 'SS ZC447'],
      programmeCode: null,
    },
  ];

  for (const c of bitsCourses) {
    const canonical = normalizeBitsCourseNumber(c.canonical);
    const alts = c.alts.map(normalizeBitsCourseNumber);
    await prisma.course.upsert({
      where: { bitsCourseNumber: canonical },
      update: {
        code: canonical,
        title: c.title,
        credits: c.credits,
        alternateCodes: alts,
        active: true,
      },
      create: {
        bitsCourseNumber: canonical,
        code: canonical,
        title: c.title,
        credits: c.credits,
        alternateCodes: alts,
      },
    });
  }

  // --- Course Offerings (for the catalog-attached subset) ---
  for (const c of bitsCourses) {
    if (!c.programmeCode || !c.slot) continue;
    const canonical = normalizeBitsCourseNumber(c.canonical);
    const prog = await prisma.programme.findUnique({ where: { code: c.programmeCode } });
    const course = await prisma.course.findUnique({ where: { bitsCourseNumber: canonical } });
    if (!prog || !course) continue;
    const sem = await prisma.semester.findUnique({
      where: { programmeId_name: { programmeId: prog.id, name: 'Sem-I 2025-26' } },
    });
    if (!sem) continue;
    await prisma.courseOffering.upsert({
      where: { courseId_semesterId: { courseId: course.id, semesterId: sem.id } },
      update: { slotInfo: c.slot },
      create: { courseId: course.id, semesterId: sem.id, slotInfo: c.slot },
    });
  }

  // --- Academic term + standard slots (Course Dibba, Phase 1; DEV ONLY) ---
  // Term-wide (all programmes) — distinct from the per-programme Semester rows
  // above; same dates as the seeded 'Sem-I 2025-26' semesters. Keyed on
  // AcademicTerm.name (@unique) and (termId, slotNo) (@@unique) so re-runs are
  // no-ops, and `update: {}` so IC-edited slot times are never clobbered by a
  // reseed. Production terms are created through the IC screen (Phase 3) —
  // this block never runs there (assertDevOnly above; seed.production.ts is
  // untouched).
  const demoTerm = await prisma.academicTerm.upsert({
    where: { name: '2025-26 Sem 1' },
    update: {},
    create: {
      name: '2025-26 Sem 1',
      year: 2025,
      term: 'FIRST',
      ...SEM_I_2025_26,
    },
  });
  for (const s of STANDARD_SLOTS) {
    await prisma.slotTiming.upsert({
      where: { termId_slotNo: { termId: demoTerm.id, slotNo: s.slotNo } },
      update: {},
      create: { termId: demoTerm.id, slotNo: s.slotNo, day: s.day, session: s.session },
    });
  }

  // --- Default Template (legacy TipTap skeleton — dev only) ---
  await prisma.template.upsert({
    where: { name: 'Standard Handout' },
    update: {},
    create: {
      name: 'Standard Handout',
      contentJson: {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 1 },
            content: [{ type: 'text', text: 'Course Handout' }],
          },
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: 'Part A — Course Description' }],
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Auto-filled from Course master.' }],
          },
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: 'Part B — Course Plan' }],
          },
          { type: 'paragraph' },
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: 'Evaluative Components' }],
          },
          { type: 'paragraph' },
        ],
      },
    },
  });

  // --- SME assignment (Prompt 12-a/12-b; smoke seed; non-fatal) ---
  // Pre-assigns an SME to one demo request so the SME approval queue isn't
  // empty, and so the manual walkthrough has a request whose faculty-submit
  // routes to SME_REVIEW. Idempotent on requestId (@unique). Non-fatal: warns
  // + skips if the dependencies aren't present on a freshly-migrated DB.
  try {
    const [sme, hog, request] = await Promise.all([
      prisma.user.findFirst({
        where: { roles: { some: { role: { name: RoleName.SME } } } },
        select: { id: true },
      }),
      prisma.user.findFirst({
        where: { roles: { some: { role: { name: RoleName.HOG } } } },
        select: { id: true },
      }),
      prisma.handoutRequest.findFirst({
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      }),
    ]);
    if (!sme || !hog || !request) {
      console.warn(
        '[seed] SME assignment skipped:',
        !sme ? 'no SME user found' : !hog ? 'no HOG user found' : 'no HandoutRequest exists yet',
      );
    } else {
      await prisma.smeAssignment.upsert({
        where: { requestId: request.id },
        update: { smeUserId: sme.id, assignedById: hog.id },
        create: { requestId: request.id, smeUserId: sme.id, assignedById: hog.id },
      });
    }
  } catch (err) {
    console.warn('[seed] SME assignment upsert failed (non-fatal):', err);
  }

  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

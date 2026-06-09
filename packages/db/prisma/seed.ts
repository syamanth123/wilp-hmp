import { PrismaClient, RoleName, FacultyType, NotificationChannel } from '@prisma/client';
import bcrypt from 'bcryptjs';
import {
  SME_NOTIFICATION_TEMPLATES,
  PUBLISH_NOTIFICATION_TEMPLATES,
} from '../src/notification-templates';
import { normalizeBitsCourseNumber } from '../src/course-code';

const prisma = new PrismaClient();

const PERMISSIONS: Array<{ key: string; label: string; roles: RoleName[] }> = [
  // user mgmt
  { key: 'user.read', label: 'View users', roles: [RoleName.ADMIN] },
  { key: 'user.create', label: 'Create users', roles: [RoleName.ADMIN] },
  { key: 'user.update', label: 'Update users', roles: [RoleName.ADMIN] },
  { key: 'user.deactivate', label: 'Deactivate users', roles: [RoleName.ADMIN] },
  // academic
  {
    key: 'academic.read',
    label: 'View academic structure',
    roles: [
      RoleName.ADMIN,
      RoleName.INSTRUCTION_CELL,
      RoleName.HOG,
      RoleName.PROGRAMME_COMMITTEE,
      RoleName.FACULTY,
    ],
  },
  { key: 'academic.manage', label: 'Manage academic structure', roles: [RoleName.ADMIN] },
  // workflow config
  { key: 'workflow.config', label: 'Configure workflow', roles: [RoleName.ADMIN] },
  // handout request
  {
    key: 'request.initiate',
    label: 'Initiate handout request',
    roles: [RoleName.INSTRUCTION_CELL],
  },
  { key: 'request.allocate', label: 'Allocate faculty', roles: [RoleName.HOG] },
  {
    key: 'request.assign',
    label: 'Assign handout to faculty',
    roles: [RoleName.PROGRAMME_COMMITTEE],
  },
  { key: 'handout.edit', label: 'Edit handout', roles: [RoleName.FACULTY] },
  { key: 'handout.submit', label: 'Submit handout', roles: [RoleName.FACULTY] },
  {
    key: 'handout.review',
    label: 'Review handout',
    roles: [RoleName.PROGRAMME_COMMITTEE, RoleName.HOG],
  },
  { key: 'handout.approve', label: 'Approve handout', roles: [RoleName.HOG] },
  { key: 'handout.publish', label: 'Publish handout', roles: [RoleName.INSTRUCTION_CELL] },
  {
    key: 'handout.archive',
    label: 'Archive handout',
    roles: [RoleName.ADMIN, RoleName.INSTRUCTION_CELL],
  },
  // audit
  { key: 'audit.read', label: 'View audit logs', roles: [RoleName.ADMIN] },
  // ai
  {
    key: 'ai.use',
    label: 'Use AI features',
    roles: [RoleName.HOG, RoleName.PROGRAMME_COMMITTEE, RoleName.FACULTY],
  },
  // SME advisory flow (Prompt 5). handout.read + comment.write are foundational
  // permissions the rest of the app currently relies on via role gates — they
  // were missing from the seeded set. Added here so future RBAC-tightening
  // work has them to check against.
  {
    key: 'handout.read',
    label: 'View assigned handouts',
    roles: [
      RoleName.ADMIN,
      RoleName.INSTRUCTION_CELL,
      RoleName.HOG,
      RoleName.PROGRAMME_COMMITTEE,
      RoleName.FACULTY,
      RoleName.SME,
    ],
  },
  {
    key: 'comment.write',
    label: 'Add comments to a handout',
    roles: [
      RoleName.ADMIN,
      RoleName.INSTRUCTION_CELL,
      RoleName.HOG,
      RoleName.PROGRAMME_COMMITTEE,
      RoleName.FACULTY,
      RoleName.SME,
    ],
  },
  {
    key: 'handout.advise',
    label: 'View assigned handouts and add advisory comments',
    roles: [RoleName.ADMIN, RoleName.SME],
  },
];

async function main() {
  console.log('Seeding HMP database...');

  // --- Roles & Permissions ---
  const allRoles = Object.values(RoleName);
  const roleRecords = await Promise.all(
    allRoles.map((name) =>
      prisma.role.upsert({
        where: { name },
        update: {},
        create: { name, description: name.replace(/_/g, ' ') },
      }),
    ),
  );
  const roleMap = new Map(roleRecords.map((r) => [r.name, r]));

  for (const p of PERMISSIONS) {
    const perm = await prisma.permission.upsert({
      where: { key: p.key },
      update: { label: p.label },
      create: { key: p.key, label: p.label },
    });
    for (const roleName of p.roles) {
      const role = roleMap.get(roleName)!;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
        update: {},
        create: { roleId: role.id, permissionId: perm.id },
      });
    }
  }

  // --- Users ---
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
        startDate: new Date('2025-08-01'),
        endDate: new Date('2025-12-15'),
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

  // --- Workflow Config ---
  await prisma.workflowConfig.upsert({
    where: { key: 'default' },
    update: {},
    create: {
      key: 'default',
      matrixJson: {
        stages: ['HOG_REVIEW', 'PC_REVIEW', 'HOG_FINAL', 'IC_PUBLISH'],
        rework: { allowedFrom: ['PC_REVIEW', 'HOG_FINAL'] },
      },
    },
  });

  // --- Default Notification Templates ---
  const templates = [
    {
      key: 'handout.requested',
      subject: 'New handout request {{refNo}}',
      body: 'A new handout request {{refNo}} has been initiated.',
    },
    {
      key: 'handout.allocated',
      subject: 'Faculty allocated for {{refNo}}',
      body: 'Faculty allocation completed for {{refNo}}.',
    },
    {
      key: 'handout.assigned',
      subject: 'You have been assigned {{refNo}}',
      body: 'Please log in to view and edit your assigned handout.',
    },
    {
      key: 'handout.submitted',
      subject: 'Handout {{refNo}} submitted',
      body: 'Handout {{refNo}} is now awaiting review.',
    },
    {
      key: 'handout.rework',
      subject: 'Rework requested on {{refNo}}',
      body: 'Please address the review comments and resubmit.',
    },
    {
      key: 'handout.review_approved',
      subject: 'Review approved for {{refNo}}',
      body: 'PC has approved {{refNo}} and forwarded to HOG.',
    },
    {
      key: 'handout.approved',
      subject: 'Handout {{refNo}} approved',
      body: 'Handout {{refNo}} has been approved.',
    },
    {
      key: 'handout.rejected',
      subject: 'Handout {{refNo}} rejected',
      body: 'Handout {{refNo}} has been rejected.',
    },
    {
      key: 'handout.published',
      subject: 'Handout {{refNo}} published to LMS',
      body: 'Handout {{refNo}} has been published to Taxila.',
    },
    // SME advisory templates (Prompt 8) + Taxila publish templates (Prompt 9b).
    // Defined in shared constants so the token-contract unit test renders
    // byte-identical strings — see packages/db/src/notification-templates.ts.
    ...SME_NOTIFICATION_TEMPLATES.map((t) => ({ key: t.key, subject: t.subject, body: t.body })),
    ...PUBLISH_NOTIFICATION_TEMPLATES.map((t) => ({
      key: t.key,
      subject: t.subject,
      body: t.body,
    })),
  ];
  for (const t of templates) {
    await prisma.notificationTemplate.upsert({
      where: { key: t.key },
      update: { subject: t.subject, body: t.body },
      create: { ...t, channels: [NotificationChannel.IN_PORTAL, NotificationChannel.EMAIL] },
    });
  }

  // --- Default Template ---
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

  // --- SME nomination (smoke seed; non-fatal) ---
  // Appended after the existing seed flow. Wrapped in try/catch so a missing
  // dependency (no SME user, no PC user, or no HandoutRequest in DB yet)
  // surfaces as a console.warn instead of aborting the rest of the seed.
  // The first HandoutRequest is created via the IC server action, not seeded,
  // so on a freshly-migrated DB this block will warn and skip — the next run
  // of `pnpm db:seed` after any IC create will succeed without further work.
  try {
    const [sme, pc, request] = await Promise.all([
      prisma.user.findFirst({
        where: { roles: { some: { role: { name: RoleName.SME } } } },
        select: { id: true },
      }),
      prisma.user.findFirst({
        where: { email: 'pc@hmp.local' },
        select: { id: true },
      }),
      prisma.handoutRequest.findFirst({
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      }),
    ]);
    if (!sme || !pc || !request) {
      console.warn(
        '[seed] SME nomination skipped:',
        !sme
          ? 'no SME user found'
          : !pc
            ? 'no PC user found'
            : 'no HandoutRequest exists yet (create one via IC flow then re-seed)',
      );
    } else {
      // No @@unique on (requestId, smeUserId, topic), so we do a find-or-create
      // by composite criteria to keep the seed idempotent across re-runs.
      const existing = await prisma.smeNomination.findFirst({
        where: {
          requestId: request.id,
          smeUserId: sme.id,
          nominatedById: pc.id,
          topic: 'Industry perspective on architectures',
        },
        select: { id: true },
      });
      if (existing) {
        await prisma.smeNomination.update({
          where: { id: existing.id },
          data: { status: 'PENDING', notes: null },
        });
      } else {
        await prisma.smeNomination.create({
          data: {
            requestId: request.id,
            smeUserId: sme.id,
            nominatedById: pc.id,
            topic: 'Industry perspective on architectures',
            status: 'PENDING',
          },
        });
      }
    }
  } catch (err) {
    console.warn('[seed] SME nomination upsert failed (non-fatal):', err);
  }

  // --- SME assignment (Prompt 12-a; smoke seed; non-fatal) ---
  // Additive alongside the SME-nomination seed above (which is removed in
  // 12-b with the SmeNomination table). Pre-assigns an SME to one demo
  // request so the SME approval queue isn't empty when 12-b's UI lands, and
  // so the 12-a manual walkthrough has a request whose faculty-submit routes
  // to SME_REVIEW. Idempotent on requestId (@unique). Non-fatal: warns + skips
  // if the dependencies aren't present on a freshly-migrated DB.
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

import { type PrismaClient, RoleName } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { DEPARTMENTS } from './seed-scaffolding';

/**
 * DEV ONLY (v1.4): puts the demo programmes and people into departments, and adds an MBA HOG and PC
 * so the department-first pickers have something to show. Never overwrites a department someone has
 * already set. Called from seed.ts; can also run on its own against a demo database.
 */
export async function seedDepartmentsDemo(prisma: PrismaClient): Promise<void> {
  for (const d of DEPARTMENTS) {
    await prisma.department.upsert({ where: { code: d.code }, update: {}, create: d });
  }
  const dept = new Map(
    (await prisma.department.findMany({ select: { id: true, code: true } })).map((d) => [
      d.code,
      d.id,
    ]),
  );

  const programmes: Record<string, string> = {
    'MTECH-SE': 'CSIS',
    'MTECH-DS': 'CSIS',
    'MBA-WILP': 'MBA',
  };
  for (const [code, d] of Object.entries(programmes)) {
    await prisma.programme.updateMany({
      where: { code, departmentId: null },
      data: { departmentId: dept.get(d)! },
    });
  }

  const people: Record<string, string> = {
    'hog@hmp.local': 'CSIS',
    'pc@hmp.local': 'CSIS',
    'sme@hmp.local': 'CSIS',
    'faculty@hmp.local': 'CSIS',
    'faculty2@hmp.local': 'CSIS',
    'faculty.off@hmp.local': 'CSIS',
    'faculty.off2@hmp.local': 'MBA',
    'faculty.adj@hmp.local': 'MBA',
    'faculty.guest@hmp.local': 'EEE',
  };
  for (const [email, d] of Object.entries(people)) {
    await prisma.user.updateMany({
      where: { email, departmentId: null },
      data: { departmentId: dept.get(d)! },
    });
  }

  const password = await bcrypt.hash('password', 10);
  const extra = [
    { email: 'hog.mba@hmp.local', name: 'Prof. Meera Iyer', role: RoleName.HOG, dept: 'MBA' },
    {
      email: 'pc.mba@hmp.local',
      name: 'Dr. Arjun Rao',
      role: RoleName.PROGRAMME_COMMITTEE,
      dept: 'MBA',
    },
  ];
  for (const u of extra) {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: u.role } });
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        email: u.email,
        name: u.name,
        passwordHash: password,
        departmentId: dept.get(u.dept)!,
      },
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      update: {},
      create: { userId: user.id, roleId: role.id },
    });
  }
}

// `tsx prisma/seed-departments-demo.ts` — run on its own (dev databases only).
if (process.argv[1]?.endsWith('seed-departments-demo.ts')) {
  void (async () => {
    const { assertDevOnly } = await import('./seed-scaffolding');
    assertDevOnly();
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    await seedDepartmentsDemo(prisma);
    await prisma.$disconnect();
    console.log('[seed] departments demo data done');
  })();
}

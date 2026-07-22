import { PrismaClient, RoleName } from '@prisma/client';
import { seedScaffolding } from './seed-scaffolding';

/**
 * Production seed. Seeds ONLY the environment-agnostic scaffolding (RBAC,
 * notification templates, workflow config — via `seedScaffolding`) plus EXACTLY
 * ONE admin user, whose credentials come from the environment.
 *
 * There are NO default passwords and NO `@hmp.local` demo users here — those
 * live in the dev-only seed.ts. The admin password is supplied PRE-HASHED
 * (bcrypt) via env, which forces the deployer to make a deliberate credential
 * decision before anything touches the database:
 *
 *   ADMIN_EMAIL="admin@your-domain"
 *   ADMIN_INITIAL_PASSWORD_HASH="$(node -e "console.log(require('bcryptjs').hashSync('YOUR_PASSWORD', 12))")"
 *
 * Run: pnpm --filter @hmp/db db:seed:prod
 */

const prisma = new PrismaClient();

/** Read + validate the admin credentials from env. Throws (non-zero exit) if
 * either is missing — we refuse to seed a production admin with a default. */
export function resolveProductionAdmin(): { email: string; passwordHash: string } {
  const email = process.env.ADMIN_EMAIL;
  const passwordHash = process.env.ADMIN_INITIAL_PASSWORD_HASH;
  if (!email || !passwordHash) {
    throw new Error(
      'ADMIN_EMAIL and ADMIN_INITIAL_PASSWORD_HASH must both be set for the production seed — ' +
        'refusing to seed with defaults. Generate a hash with: ' +
        `node -e "console.log(require('bcryptjs').hashSync('YOUR_PASSWORD', 12))"`,
    );
  }
  return { email, passwordHash };
}

/** Idempotency guard: only create the admin on a truly empty user table. A
 * second run finds users and no-ops (never a duplicate admin). */
export async function shouldCreateAdmin(client: Pick<PrismaClient, 'user'>): Promise<boolean> {
  const count = await client.user.count();
  return count === 0;
}

export async function runProductionSeed(client: PrismaClient): Promise<void> {
  const admin = resolveProductionAdmin(); // throws before any DB write if unset

  await seedScaffolding(client);

  if (!(await shouldCreateAdmin(client))) {
    console.log('[seed:prod] users already exist — scaffolding refreshed, admin creation skipped.');
    return;
  }

  const adminRole = await client.role.findUniqueOrThrow({ where: { name: RoleName.ADMIN } });
  const user = await client.user.create({
    data: { email: admin.email, name: 'Administrator', passwordHash: admin.passwordHash },
  });
  await client.userRole.create({ data: { userId: user.id, roleId: adminRole.id } });
  console.log(`[seed:prod] created admin ${admin.email} + RBAC/template/config scaffolding.`);
}

// Only run when invoked directly (not when imported by a test).
if (process.argv[1] && process.argv[1].includes('seed.production')) {
  runProductionSeed(prisma)
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

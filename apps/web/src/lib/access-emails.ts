import { prisma, NotificationChannel, RoleName } from '@hmp/db';
import { deliver } from './notifications';
import { loadMailContext } from './email/context';
import { roleChangedEmail, welcomeEmail } from './email/other';
import { getSamlSetup } from './saml/config';

/**
 * v1.4.3 (H33) — the welcome email for a new account, and "your access changed" after a role or department
 * change (or its undo). Neither ever contains a password: the welcome says "Sign in with your BITS ID" when
 * BITS sign-in is set up on this server, otherwise that the Admin gives the password.
 */

async function person(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      active: true,
      department: { select: { name: true } },
      roles: { select: { role: { select: { name: true } } } },
    },
  });
}

export function ssoReady(): boolean {
  try {
    return getSamlSetup().status === 'ok';
  } catch {
    return false;
  }
}

export async function sendWelcome(
  userId: string,
  actor: { id: string; name: string },
): Promise<boolean> {
  const u = await person(userId);
  if (!u?.active) return false;
  const roles = u.roles.map((r) => r.role.name as RoleName);
  const mail = welcomeEmail(
    { name: u.name, email: u.email, roles, department: u.department?.name ?? null },
    { addedBy: actor.name, sso: ssoReady() },
    await loadMailContext(actor.name),
  );
  await deliver({
    userId: u.id,
    email: u.email,
    role: roles[0] ?? RoleName.FACULTY,
    subject: mail.subject,
    body: mail.summary,
    link: '/',
    channels: [NotificationChannel.EMAIL],
    metaKind: 'user.welcome',
    urgent: true,
    mail,
  });
  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      action: 'user.welcome',
      entity: 'User',
      entityId: u.id,
      after: { email: u.email },
    },
  });
  return true;
}

export interface AccessState {
  roles: string[];
  departmentId: string | null;
}

/** Tells the person when their roles or department really changed (nothing for a name / email edit). */
export async function tellAccessChanged(
  userId: string,
  before: AccessState,
  after: AccessState,
  actor: { name: string },
  undo = false,
): Promise<boolean> {
  const same =
    before.departmentId === after.departmentId &&
    before.roles.length === after.roles.length &&
    before.roles.every((r) => after.roles.includes(r));
  if (same) return false;
  const u = await person(userId);
  if (!u?.active) return false;
  const deptIds = [before.departmentId, after.departmentId].filter((x): x is string => !!x);
  const names = new Map(
    (
      await prisma.department.findMany({
        where: { id: { in: deptIds } },
        select: { id: true, name: true },
      })
    ).map((d) => [d.id, d.name]),
  );
  const dept = (id: string | null) => (id ? (names.get(id) ?? null) : null);
  const mail = roleChangedEmail(
    { name: u.name },
    {
      by: actor.name,
      undo,
      before: { roles: before.roles as RoleName[], department: dept(before.departmentId) },
      after: { roles: after.roles as RoleName[], department: dept(after.departmentId) },
    },
    await loadMailContext(actor.name),
  );
  await deliver({
    userId: u.id,
    email: u.email,
    role: (after.roles[0] as RoleName | undefined) ?? RoleName.FACULTY,
    subject: mail.subject,
    body: mail.summary,
    link: '/',
    channels: [NotificationChannel.IN_PORTAL, NotificationChannel.EMAIL],
    metaKind: undo ? 'user.access-undone' : 'user.access-changed',
    urgent: true,
    mail,
  });
  return true;
}

export async function accessOf(userId: string): Promise<AccessState | null> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { departmentId: true, roles: { select: { role: { select: { name: true } } } } },
  });
  return u ? { departmentId: u.departmentId, roles: u.roles.map((r) => r.role.name) } : null;
}

import { prisma, NotificationChannel, RoleName } from '@hmp/db';
import { loadMailContext } from './email/context';
import { backupEmail } from './email/other';
import { audit } from './audit';
import { BACKUP_ROLES } from './away';
import { formatDueDay } from './deadlines';
import { deliver } from './notifications';

/**
 * v1.4.2 — saving "away until … , back-up …" (docs/plans/v1.4.2-workload.md §4, H18): by the person in My
 * settings, or by the IC / Admin on Edit person (sudden leave). The back-up is told.
 */

export type AwayResult = { ok: true; message: string } | { ok: false; error: string };

/** "2026-11-20" → midnight India time on that day. */
export const istMidnight = (iso: string) => new Date(`${iso}T00:00:00+05:30`);
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function saveAway(input: {
  person: { id: string; name: string; roles: RoleName[] };
  actorId: string;
  from: string;
  until: string;
  backupId: string;
}): Promise<AwayResult> {
  const { person } = input;
  if (!ISO.test(input.until) || (input.from && !ISO.test(input.from)))
    return { ok: false, error: 'Pick the dates.' };
  const from = input.from ? istMidnight(input.from) : null;
  const until = istMidnight(input.until);
  const today = istMidnight(new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10));
  if (until < today) return { ok: false, error: 'The last day away is in the past.' };
  if (from && from > until) return { ok: false, error: 'The first day is after the last day.' };

  const roles = person.roles.filter((r) => BACKUP_ROLES.includes(r));
  let backup: { id: string; name: string; email: string } | null = null;
  if (input.backupId) {
    if (roles.length === 0)
      return { ok: false, error: 'A back-up is for HOG, PC, SME and IC work.' };
    if (input.backupId === person.id)
      return { ok: false, error: "Someone can't be their own back-up." };
    backup = await prisma.user.findFirst({
      where: {
        id: input.backupId,
        active: true,
        roles: { some: { role: { name: { in: roles } } } },
      },
      select: { id: true, name: true, email: true },
    });
    if (!backup) return { ok: false, error: 'Pick an active colleague with the same role.' };
  } else if (roles.length > 0) {
    return { ok: false, error: 'Pick a back-up: they look after the requests meanwhile.' };
  }

  const before = await prisma.userPreference.findUnique({
    where: { userId: person.id },
    select: { awayFrom: true, awayUntil: true, backupUserId: true },
  });
  const data = { awayFrom: from, awayUntil: until, backupUserId: backup?.id ?? null };
  await prisma.userPreference.upsert({
    where: { userId: person.id },
    create: { userId: person.id, ...data },
    update: data,
  });
  await audit({
    actorId: input.actorId,
    action: 'user.away',
    entity: 'User',
    entityId: person.id,
    before,
    after: data,
  });
  if (backup && backup.id !== before?.backupUserId) {
    const when = `${from ? `${formatDueDay(from)} – ` : 'now until '}${formatDueDay(until)}`;
    await deliver({
      userId: backup.id,
      email: backup.email,
      role: roles[0] ?? RoleName.HOG,
      subject: `You are ${person.name}'s back-up (${when})`,
      body: `${person.name} is away ${when}. Meanwhile you see their requests, get their notices and reminders, and can act for them — their items show in your "My work", marked "for ${person.name}".`,
      link: '/',
      channels: [NotificationChannel.IN_PORTAL, NotificationChannel.EMAIL],
      metaKind: 'user.backup',
      urgent: true,
      mail: backupEmail(
        { name: backup.name },
        {
          named: true,
          person: person.name,
          from: from ? formatDueDay(from) : 'today',
          until: formatDueDay(until),
        },
        await loadMailContext(),
      ),
    });
  }
  // v1.4.3: the back-up who was replaced (or dropped) is told.
  if (before?.backupUserId && before.backupUserId !== (backup?.id ?? null)) {
    const old = await prisma.user.findUnique({
      where: { id: before.backupUserId },
      select: { id: true, name: true, email: true, active: true },
    });
    if (old?.active)
      await deliver({
        userId: old.id,
        email: old.email,
        role: roles[0] ?? RoleName.HOG,
        subject: `You are no longer ${person.name}'s back-up`,
        body: `${person.name} chose someone else as back-up (or none), so their work no longer shows in your My work.`,
        link: '/',
        channels: [NotificationChannel.IN_PORTAL, NotificationChannel.EMAIL],
        metaKind: 'user.backup-removed',
        mail: backupEmail(
          { name: old.name },
          { named: false, person: person.name },
          await loadMailContext(),
        ),
      });
  }
  return {
    ok: true,
    message: backup
      ? `Saved. ${backup.name} is told and looks after the requests meanwhile.`
      : 'Saved. Pickers show the away dates.',
  };
}

export async function endAway(personId: string, actorId: string): Promise<void> {
  await prisma.userPreference.updateMany({
    where: { userId: personId },
    data: { awayFrom: null, awayUntil: null, backupUserId: null },
  });
  await audit({ actorId, action: 'user.back', entity: 'User', entityId: personId });
}

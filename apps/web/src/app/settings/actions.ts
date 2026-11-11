'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma, EmailMode, RoleName } from '@hmp/db';
import { getSessionUser } from '@hmp/auth';
import { audit } from '@/lib/audit';
import { absoluteEmailLink } from '@/lib/notifications';
import { newCalendarToken, stopCalendarLink } from '@/lib/preferences';
import { BACKUP_ROLES } from '@/lib/away';

/** v1.4.2 — My settings (docs/plans/v1.4.2-workload.md §4, §7). Each person changes only their own. */

type Result = { ok: true; message?: string; link?: string } | { ok: false; error: string };
const ENDED: Result = { ok: false, error: 'Your session has ended. Sign in again.' };

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date.');
/** "2026-11-20" → midnight India time on that day. */
const istMidnight = (iso: string) => new Date(`${iso}T00:00:00+05:30`);

const awaySchema = z.object({
  from: isoDay.or(z.literal('')),
  until: isoDay,
  backupId: z.string().cuid().or(z.literal('')),
});

export async function saveAwayAction(_: unknown, formData: FormData): Promise<Result> {
  const me = await getSessionUser();
  if (!me) return ENDED;
  const parsed = awaySchema.safeParse({
    from: formData.get('from') ?? '',
    until: formData.get('until') ?? '',
    backupId: formData.get('backupId') ?? '',
  });
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the dates.' };
  const from = parsed.data.from ? istMidnight(parsed.data.from) : null;
  const until = istMidnight(parsed.data.until);
  const today = istMidnight(new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10));
  if (until < today) return { ok: false, error: 'The last day away is in the past.' };
  if (from && from > until) return { ok: false, error: 'The first day is after the last day.' };

  const myBackupRoles = me.roles.filter((r) => BACKUP_ROLES.includes(r));
  let backupId: string | null = null;
  if (parsed.data.backupId) {
    if (myBackupRoles.length === 0)
      return { ok: false, error: 'A back-up is for HOG, PC, SME and IC work.' };
    if (parsed.data.backupId === me.id)
      return { ok: false, error: "You can't be your own back-up." };
    const b = await prisma.user.findFirst({
      where: {
        id: parsed.data.backupId,
        active: true,
        roles: { some: { role: { name: { in: myBackupRoles } } } },
      },
      select: { id: true },
    });
    if (!b) return { ok: false, error: 'Pick an active colleague with the same role.' };
    backupId = b.id;
  } else if (myBackupRoles.length > 0) {
    return {
      ok: false,
      error: 'Pick a back-up: they look after your requests while you are away.',
    };
  }

  const before = await prisma.userPreference.findUnique({
    where: { userId: me.id },
    select: { awayFrom: true, awayUntil: true, backupUserId: true },
  });
  await prisma.userPreference.upsert({
    where: { userId: me.id },
    create: { userId: me.id, awayFrom: from, awayUntil: until, backupUserId: backupId },
    update: { awayFrom: from, awayUntil: until, backupUserId: backupId },
  });
  await audit({
    actorId: me.id,
    action: 'user.away',
    entity: 'User',
    entityId: me.id,
    before,
    after: { awayFrom: from, awayUntil: until, backupUserId: backupId },
  });
  revalidatePath('/settings');
  return {
    ok: true,
    message: 'Saved. Your back-up is told and sees your requests while you are away.',
  };
}

export async function endAwayAction(): Promise<Result> {
  const me = await getSessionUser();
  if (!me) return ENDED;
  await prisma.userPreference.updateMany({
    where: { userId: me.id },
    data: { awayFrom: null, awayUntil: null, backupUserId: null },
  });
  await audit({ actorId: me.id, action: 'user.back', entity: 'User', entityId: me.id });
  revalidatePath('/settings');
  return { ok: true, message: 'Welcome back — you are no longer shown as away.' };
}

const emailSchema = z.object({
  emailMode: z.nativeEnum(EmailMode),
  weeklySummary: z.boolean(),
});

export async function saveEmailAction(_: unknown, formData: FormData): Promise<Result> {
  const me = await getSessionUser();
  if (!me) return ENDED;
  const parsed = emailSchema.safeParse({
    emailMode: formData.get('emailMode'),
    weeklySummary: formData.get('weeklySummary') === 'on',
  });
  if (!parsed.success) return { ok: false, error: 'Pick how you want your emails.' };
  // The weekly summary is for HOG and IC (H20); keep it on for everyone else (it isn't sent to them).
  const getsSummary =
    me.roles.includes(RoleName.HOG) || me.roles.includes(RoleName.INSTRUCTION_CELL);
  const data = {
    emailMode: parsed.data.emailMode,
    weeklySummary: getsSummary ? parsed.data.weeklySummary : true,
  };
  await prisma.userPreference.upsert({
    where: { userId: me.id },
    create: { userId: me.id, ...data },
    update: data,
  });
  await audit({
    actorId: me.id,
    action: 'user.email-settings',
    entity: 'User',
    entityId: me.id,
    after: data,
  });
  revalidatePath('/settings');
  return { ok: true, message: 'Saved.' };
}

export async function makeCalendarLinkAction(): Promise<Result> {
  const me = await getSessionUser();
  if (!me) return ENDED;
  const token = await newCalendarToken(me.id);
  // Audit the event only — never the link.
  await audit({ actorId: me.id, action: 'user.calendar-link', entity: 'User', entityId: me.id });
  revalidatePath('/settings');
  return {
    ok: true,
    link: absoluteEmailLink(`/api/calendar/${token}`),
    message: 'Copy it now — HMP shows it only once. Anyone with the link sees your HMP due dates.',
  };
}

export async function stopCalendarLinkAction(): Promise<Result> {
  const me = await getSessionUser();
  if (!me) return ENDED;
  await stopCalendarLink(me.id);
  await audit({
    actorId: me.id,
    action: 'user.calendar-link-stopped',
    entity: 'User',
    entityId: me.id,
  });
  revalidatePath('/settings');
  return { ok: true, message: 'The calendar link no longer works.' };
}

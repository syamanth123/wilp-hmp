'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma, EmailMode, RoleName } from '@hmp/db';
import { getSessionUser } from '@hmp/auth';
import { audit } from '@/lib/audit';
import { absoluteEmailLink } from '@/lib/notifications';
import { newCalendarToken, stopCalendarLink } from '@/lib/preferences';
import { endAway, saveAway } from '@/lib/away-save';

/** v1.4.2 — My settings (docs/plans/v1.4.2-workload.md §4, §7). Each person changes only their own. */

type Result = { ok: true; message?: string; link?: string } | { ok: false; error: string };
const ENDED: Result = { ok: false, error: 'Your session has ended. Sign in again.' };

export async function saveAwayAction(_: unknown, formData: FormData): Promise<Result> {
  const me = await getSessionUser();
  if (!me) return ENDED;
  const r = await saveAway({
    person: { id: me.id, name: me.name, roles: me.roles },
    actorId: me.id,
    from: String(formData.get('from') ?? ''),
    until: String(formData.get('until') ?? ''),
    backupId: String(formData.get('backupId') ?? ''),
  });
  if (r.ok) revalidatePath('/settings');
  return r;
}

export async function endAwayAction(): Promise<Result> {
  const me = await getSessionUser();
  if (!me) return ENDED;
  await endAway(me.id, me.id);
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
    link: absoluteEmailLink(`/api/calendar/${token}.ics`),
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

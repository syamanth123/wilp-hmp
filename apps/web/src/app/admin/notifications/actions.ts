'use server';

import { revalidatePath } from 'next/cache';
import { prisma, NotificationChannel, RoleName } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { runDailyNow, type RunSummary } from '@/lib/daily-run';
import { deliver, emailsSettled, forgetEmailSettings } from '@/lib/notifications';
import { CATALOGUE_BY_KEY, TEMPLATE_PREFIX, unknownPlaceholders } from '@/lib/email/catalogue';
import { renderEmail } from '@/lib/email/layout';
import { previewEmail } from '@/lib/email/preview';

async function admin() {
  return requireRole(await getSessionUser(), RoleName.ADMIN);
}

/** v1.4.2: Run now — the daily run (reminders, escalation, digests), now. Each step is still sent once. */
export async function runSweepAction(): Promise<RunSummary | { error: string }> {
  try {
    await admin();
  } catch {
    return { error: "You don't have permission to do this." };
  }
  const summary = await runDailyNow();
  await emailsSettled();
  return summary;
}

export interface WordingInput {
  subject: string;
  summary: string;
  action: string;
}

type Result = { ok: true; message: string } | { ok: false; error: string };

const LIMITS: Record<keyof WordingInput, number> = { subject: 200, summary: 600, action: 1000 };
const FIELD: Record<keyof WordingInput, string> = {
  subject: 'Subject',
  summary: 'Summary',
  action: 'What to do',
};

function problems(key: string, w: WordingInput): string | null {
  const entry = CATALOGUE_BY_KEY.get(key);
  if (!entry) return 'Unknown email.';
  for (const f of Object.keys(LIMITS) as (keyof WordingInput)[]) {
    const v = w[f] ?? '';
    if (v.length > LIMITS[f]) return `${FIELD[f]} is too long (at most ${LIMITS[f]} characters).`;
    const bad = unknownPlaceholders(entry, v);
    if (bad.length)
      return `${FIELD[f]}: ${bad.map((b) => (b.startsWith('{') ? b : `{{${b}}}`)).join(', ')} ${bad.length === 1 ? 'is' : 'are'} not a placeholder of this email. Use the ones listed.`;
    if (f === 'subject' && /[\r\n]/.test(v)) return 'The subject must be one line.';
  }
  return null;
}

/** v1.4.3 (H29): save an email's wording. Saving the built-in wording again removes the edit. */
export async function saveWordingAction(key: string, w: WordingInput): Promise<Result> {
  const me = await admin();
  const entry = CATALOGUE_BY_KEY.get(key);
  if (!entry) return { ok: false, error: 'Unknown email.' };
  const clean = {
    subject: (w.subject ?? '').trim(),
    summary: (w.summary ?? '').trim(),
    action: (w.action ?? '').trim(),
  };
  const bad = problems(key, clean);
  if (bad) return { ok: false, error: bad };
  const isDefault =
    (!clean.subject || clean.subject === entry.subject) &&
    (!clean.summary || clean.summary === entry.summary) &&
    (!clean.action || clean.action === entry.action);
  const rowKey = `${TEMPLATE_PREFIX}${key}`;
  const before = await prisma.notificationTemplate.findUnique({ where: { key: rowKey } });
  if (isDefault) {
    if (before) await prisma.notificationTemplate.delete({ where: { key: rowKey } });
  } else {
    const data = {
      subject: clean.subject || entry.subject,
      body: clean.summary || entry.summary,
      action: clean.action || entry.action,
      audience: entry.to,
      editedById: me.id,
      editedAt: new Date(),
    };
    await prisma.notificationTemplate.upsert({
      where: { key: rowKey },
      create: { key: rowKey, channels: [NotificationChannel.EMAIL], ...data },
      update: data,
    });
  }
  await prisma.auditLog.create({
    data: {
      actorId: me.id,
      action: isDefault ? 'email.wording-reset' : 'email.wording',
      entity: 'NotificationTemplate',
      entityId: rowKey,
      before: before
        ? { subject: before.subject, summary: before.body, action: before.action }
        : undefined,
      after: isDefault ? { original: true } : clean,
    },
  });
  revalidatePath('/admin/notifications');
  return {
    ok: true,
    message: isDefault ? 'Back to the original wording.' : 'Saved. New emails use this wording.',
  };
}

/** The email exactly as it would be sent, with the wording on screen (saved or not). */
export async function previewEmailAction(
  key: string,
  requestId: string | null,
  w: WordingInput,
): Promise<
  { ok: true; subject: string; html: string; text: string } | { ok: false; error: string }
> {
  const me = await admin();
  const bad = problems(key, w);
  if (bad) return { ok: false, error: bad };
  const content = await previewEmail(key, requestId || null, me, w);
  if (!content) return { ok: false, error: 'There is no request to show this email with yet.' };
  return { ok: true, ...renderEmail(content) };
}

/** Sends that email to the Admin's own address, subject starting "TEST". Audit-logged. */
export async function sendTestAction(
  key: string,
  requestId: string | null,
  w: WordingInput,
): Promise<Result> {
  const me = await admin();
  const bad = problems(key, w);
  if (bad) return { ok: false, error: bad };
  const content = await previewEmail(key, requestId || null, me, w);
  if (!content) return { ok: false, error: 'There is no request to show this email with yet.' };
  const mail = { ...content, subject: `TEST — ${content.subject}` };
  const since = new Date();
  await deliver({
    userId: me.id,
    email: me.email,
    role: RoleName.ADMIN,
    subject: mail.subject,
    body: content.summary,
    link: '/admin/notifications',
    channels: [NotificationChannel.EMAIL],
    metaKind: 'email.test',
    extraMeta: { template: key, requestId },
    urgent: true,
    mail,
  });
  await emailsSettled();
  await prisma.auditLog.create({
    data: {
      actorId: me.id,
      action: 'email.test',
      entity: 'NotificationTemplate',
      entityId: `${TEMPLATE_PREFIX}${key}`,
      after: { to: me.email, requestId },
    },
  });
  const row = await prisma.notification.findFirst({
    where: {
      userId: me.id,
      channel: NotificationChannel.EMAIL,
      createdAt: { gte: since },
      meta: { path: ['kind'], equals: 'email.test' },
    },
    orderBy: { createdAt: 'desc' },
    select: { status: true, meta: true },
  });
  if (row?.status === 'FAILED')
    return {
      ok: false,
      error: `Not sent: ${String((row.meta as { error?: string } | null)?.error ?? 'the mail server refused it')}. It is in the email log.`,
    };
  return { ok: true, message: `Sent to ${me.email}. It is in the email log.` };
}

/** v1.4.3 (H28): reply-to address and help contact. */
export async function saveEmailSettingsAction(_prev: unknown, fd: FormData): Promise<Result> {
  const me = await admin();
  const replyTo = String(fd.get('replyTo') ?? '').trim();
  const help = String(fd.get('help') ?? '').trim();
  if (replyTo && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(replyTo))
    return { ok: false, error: 'The reply-to address doesn’t look like an email address.' };
  if (help.length > 200) return { ok: false, error: 'The help contact is too long (200 at most).' };
  const before = await prisma.workflowConfig.findUnique({
    where: { key: 'default' },
    select: { emailReplyTo: true, emailHelp: true },
  });
  const data = { emailReplyTo: replyTo || null, emailHelp: help || null };
  await prisma.workflowConfig.upsert({
    where: { key: 'default' },
    create: { key: 'default', matrixJson: {}, ...data },
    update: data,
  });
  await prisma.auditLog.create({
    data: {
      actorId: me.id,
      action: 'email.settings',
      entity: 'WorkflowConfig',
      entityId: 'default',
      before: before ?? undefined,
      after: data,
    },
  });
  forgetEmailSettings();
  revalidatePath('/admin/notifications');
  return { ok: true, message: 'Saved. New emails use these.' };
}

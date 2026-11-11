import { prisma } from '@hmp/db';
import { loadWordingEdits } from './catalogue';
import type { MailContext } from './events';

/**
 * v1.4.3 — what every email needs besides its facts: the site address (APP_BASE_URL, for links and the
 * logo), the reply-to and help contact (Admin → Notifications → Settings) and the Admin's wording edits.
 * Loaded once per event, not per recipient.
 */

export function siteBase(): string {
  return (process.env.APP_BASE_URL ?? process.env.NEXTAUTH_URL ?? '').replace(/\/+$/, '');
}

export function absoluteUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = siteBase();
  return base ? `${base}${path.startsWith('/') ? '' : '/'}${path}` : path;
}

export interface EmailSettings {
  replyTo: string | null;
  help: string | null;
}

export async function loadEmailSettings(): Promise<EmailSettings> {
  const cfg = await prisma.workflowConfig.findUnique({
    where: { key: 'default' },
    select: { emailReplyTo: true, emailHelp: true },
  });
  return { replyTo: cfg?.emailReplyTo?.trim() || null, help: cfg?.emailHelp?.trim() || null };
}

export async function loadMailContext(
  actorName = '',
  now: Date = new Date(),
): Promise<MailContext> {
  const [settings, edits] = await Promise.all([loadEmailSettings(), loadWordingEdits()]);
  const base = siteBase();
  return {
    actorName,
    now,
    url: absoluteUrl,
    footer: { help: settings.help, replyTo: settings.replyTo },
    logoUrl: base ? `${base}/email-logo.png` : null,
    edits,
  };
}

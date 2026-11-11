import nodemailer, { type Transporter } from 'nodemailer';

export interface SendMailInput {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  /** v1.4.3: where replies go (the IC mailbox, Admin → Notifications → Settings); none = no Reply-To. */
  replyTo?: string | null;
}

export type SendMailResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * Short limits, so a slow or unreachable mail server fails fast instead of hanging for minutes
 * (nodemailer's defaults: ~2 min to connect, 10 min idle). Callers send in the background anyway
 * (apps/web lib/notifications.ts), but a stuck connection must still end.
 */
export function smtpTimeouts() {
  const ms = Number(process.env.SMTP_TIMEOUT_MS) || 10_000;
  return { connectionTimeout: ms, greetingTimeout: ms, socketTimeout: ms * 2 };
}

let cachedTransport: Transporter | null = null;
let cachedFingerprint: string | null = null;

function readEnv() {
  return {
    host: process.env.SMTP_HOST ?? '',
    port: Number(process.env.SMTP_PORT ?? '1025'),
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.SMTP_FROM ?? 'HMP <no-reply@hmp.local>',
  };
}

function getTransport(): Transporter | null {
  const env = readEnv();
  if (!env.host) return null;
  const timeouts = smtpTimeouts();
  const fp = `${env.host}|${env.port}|${env.user}|${timeouts.connectionTimeout}`;
  if (cachedTransport && cachedFingerprint === fp) return cachedTransport;
  cachedTransport = nodemailer.createTransport({
    host: env.host,
    port: env.port,
    secure: env.port === 465,
    auth: env.user ? { user: env.user, pass: env.pass } : undefined,
    ...timeouts,
  });
  cachedFingerprint = fp;
  return cachedTransport;
}

export async function sendMail(input: SendMailInput): Promise<SendMailResult> {
  const transport = getTransport();
  if (!transport) return { ok: false, error: 'smtp_not_configured' };
  const { from } = readEnv();
  try {
    const info = await transport.sendMail({
      from,
      to: Array.isArray(input.to) ? input.to.join(', ') : input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    });
    return { ok: true, id: info.messageId };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    // Never the password or the message body.
    console.error('[email] failed', { to: input.to, subject: input.subject, error });
    return { ok: false, error };
  }
}

import nodemailer, { type Transporter } from 'nodemailer';

export interface SendMailInput {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
}

export type SendMailResult = { ok: true; id: string } | { ok: false; error: string };

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
  const fp = `${env.host}|${env.port}|${env.user}`;
  if (cachedTransport && cachedFingerprint === fp) return cachedTransport;
  cachedTransport = nodemailer.createTransport({
    host: env.host,
    port: env.port,
    secure: env.port === 465,
    auth: env.user ? { user: env.user, pass: env.pass } : undefined,
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
    });
    return { ok: true, id: info.messageId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

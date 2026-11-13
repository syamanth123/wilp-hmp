import { beforeEach, describe, expect, it, vi } from 'vitest';

// The page that triggers a notification must not wait for the mail server: the in-portal /
// email rows are written at once, the email is sent in the background and its row updated later.
const { create, update, sendMail, prefFind, cfgFind, audit } = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  sendMail: vi.fn(),
  // v1.4.2: deliver() reads the person's email mode (at once / daily digest).
  prefFind: vi.fn(),
  // v1.4.3: the reply-to and help contact (Admin → Notifications → Settings); failures go to the audit log.
  cfgFind: vi.fn(),
  audit: vi.fn(),
}));
vi.mock('@hmp/db', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    prisma: {
      notification: { create, update },
      userPreference: { findUnique: prefFind },
      workflowConfig: { findUnique: cfgFind },
      auditLog: { create: audit },
    },
  };
});
vi.mock('@hmp/integrations', () => ({ sendMail }));
vi.mock('@hmp/queue', () => ({ enqueueNotification: vi.fn() }));

import { NotificationChannel, NotificationStatus, RoleName } from '@hmp/db';
import { deliver, emailsSettled, forgetEmailSettings } from '../notifications';

const params = {
  userId: 'u1',
  email: 'faculty@example.test',
  role: RoleName.FACULTY,
  subject: 'Handout published',
  body: 'Published.',
  link: '/faculty',
  channels: [NotificationChannel.IN_PORTAL, NotificationChannel.EMAIL],
  metaKind: 'transition',
};

describe('email is sent after the page has answered', () => {
  beforeEach(() => {
    let n = 0;
    create.mockReset().mockImplementation(async () => ({ id: `row-${++n}` }));
    update.mockReset().mockResolvedValue({});
    sendMail.mockReset();
    prefFind.mockReset().mockResolvedValue(null);
    cfgFind.mockReset().mockResolvedValue(null);
    audit.mockReset().mockResolvedValue({});
    forgetEmailSettings();
  });

  it('a slow mail server does not hold up deliver(); the row ends SENT', async () => {
    let release!: () => void;
    sendMail.mockReturnValue(
      new Promise((r) => {
        release = () => r({ ok: true, id: 'm1' });
      }),
    );
    const started = Date.now();
    await deliver(params);
    expect(Date.now() - started).toBeLessThan(500);
    expect(create).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledTimes(1); // in-portal only, so far
    release();
    await emailsSettled();
    expect(update).toHaveBeenLastCalledWith({
      where: { id: 'row-2' },
      data: { status: NotificationStatus.SENT, sentAt: expect.any(Date) },
    });
  });

  it('a failed send marks the email row FAILED with the reason', async () => {
    sendMail.mockResolvedValue({ ok: false, error: 'Greeting never received' });
    await deliver(params);
    await emailsSettled();
    expect(update).toHaveBeenLastCalledWith({
      where: { id: 'row-2' },
      data: {
        status: NotificationStatus.FAILED,
        meta: { kind: 'transition', error: 'Greeting never received' },
      },
    });
  });

  it('v1.4.2: daily digest — the email waits (PENDING, digest) and is not sent; the in-HMP notice is immediate', async () => {
    prefFind.mockResolvedValue({ emailMode: 'DIGEST' });
    await deliver(params);
    await emailsSettled();
    expect(sendMail).not.toHaveBeenCalled();
    expect(create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        channel: NotificationChannel.EMAIL,
        status: NotificationStatus.PENDING,
        meta: {
          kind: 'transition',
          digest: true,
          // v1.4.3: the compact block for the 09:00 digest is kept with the held email.
          digestItem: expect.objectContaining({
            title: 'Handout published',
            lines: ['Published.'],
          }),
        },
      }),
    });
    expect(update).toHaveBeenCalledTimes(1); // the in-portal row only
  });

  it('v1.4.2: urgent notices go at once even in digest mode', async () => {
    prefFind.mockResolvedValue({ emailMode: 'DIGEST' });
    sendMail.mockResolvedValue({ ok: true, id: 'm2' });
    await deliver({ ...params, urgent: true });
    await emailsSettled();
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(prefFind).not.toHaveBeenCalled();
  });

  it('v1.4.3: every email is in the shared layout, with a plain-text version and the reply-to', async () => {
    cfgFind.mockResolvedValue({ emailReplyTo: 'ic@example.test', emailHelp: 'IC desk' });
    sendMail.mockResolvedValue({ ok: true, id: 'm3' });
    await deliver(params);
    await emailsSettled();
    const sent = sendMail.mock.calls[0]![0] as {
      subject: string;
      html: string;
      text: string;
      replyTo: string;
    };
    expect(sent.subject).toBe('[HMP] Handout published');
    expect(sent.html).toContain('Handout Management Portal');
    expect(sent.html).toContain('Published.');
    expect(sent.text).toContain('Published.');
    expect(sent.text).toContain('Replies to this email go to ic@example.test.');
    expect(sent.replyTo).toBe('ic@example.test');
    // The email row carries the email's own subject (the email log shows it).
    expect(create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        channel: NotificationChannel.EMAIL,
        subject: '[HMP] Handout published',
      }),
    });
  });

  it('v1.4.3 (H32): a failed send is also written to the audit log, without the body', async () => {
    sendMail.mockResolvedValue({ ok: false, error: 'Mailbox unavailable' });
    await deliver(params);
    await emailsSettled();
    expect(audit).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'email.failed',
        entity: 'Notification',
        after: {
          to: 'faculty@example.test',
          subject: '[HMP] Handout published',
          error: 'Mailbox unavailable',
        },
      }),
    });
  });
});

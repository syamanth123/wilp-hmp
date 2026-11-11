import { beforeEach, describe, expect, it, vi } from 'vitest';

// The page that triggers a notification must not wait for the mail server: the in-portal /
// email rows are written at once, the email is sent in the background and its row updated later.
const { create, update, sendMail, prefFind } = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  sendMail: vi.fn(),
  // v1.4.2: deliver() reads the person's email mode (at once / daily digest).
  prefFind: vi.fn(),
}));
vi.mock('@hmp/db', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    prisma: { notification: { create, update }, userPreference: { findUnique: prefFind } },
  };
});
vi.mock('@hmp/integrations', () => ({ sendMail }));
vi.mock('@hmp/queue', () => ({ enqueueNotification: vi.fn() }));

import { NotificationChannel, NotificationStatus, RoleName } from '@hmp/db';
import { deliver, emailsSettled } from '../notifications';

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
        meta: { kind: 'transition', digest: true },
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
});

import { createServer, type Server } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sendMail, smtpTimeouts } from './email';

// A mail server that accepts the connection and then says nothing — the slow-server case that
// used to hold a page for minutes (nodemailer's default greeting/socket limits).
describe('sendMail with a silent mail server', () => {
  let server: Server;
  let port = 0;
  beforeAll(async () => {
    server = createServer(() => undefined);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as { port: number }).port;
  });
  afterAll(() => {
    server.close();
    vi.unstubAllEnvs();
  });

  it('defaults to 10 s limits', () => {
    vi.stubEnv('SMTP_TIMEOUT_MS', '');
    expect(smtpTimeouts()).toEqual({
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  });

  it('gives up quickly, returns an error and logs it without the password', async () => {
    vi.stubEnv('SMTP_HOST', '127.0.0.1');
    vi.stubEnv('SMTP_PORT', String(port));
    vi.stubEnv('SMTP_USER', 'hmp@example.test');
    vi.stubEnv('SMTP_PASS', 'secret-pass-123');
    vi.stubEnv('SMTP_TIMEOUT_MS', '300');
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const started = Date.now();
    const r = await sendMail({ to: 'a@example.test', subject: 'Hi', html: '<p>x</p>' });
    expect(r.ok).toBe(false);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(log).toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret-pass-123');
    log.mockRestore();
  });
});

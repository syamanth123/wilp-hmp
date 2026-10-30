import { describe, expect, it } from 'vitest';
import { within } from './within';

describe('within', () => {
  it('returns the value when the work finishes in time', async () => {
    await expect(within(async () => 42, 500)).resolves.toEqual({ ok: true, value: 42 });
  });

  it('gives up on work that never finishes (a hung Redis) within the limit', async () => {
    const started = Date.now();
    const result = await within(() => new Promise<never>(() => {}), 200);
    expect(result).toEqual({ ok: false, reason: 'timeout' });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('reports a failure instead of throwing', async () => {
    await expect(
      within(async () => {
        throw new Error('ECONNREFUSED');
      }, 500),
    ).resolves.toEqual({ ok: false, reason: 'error' });
  });
});

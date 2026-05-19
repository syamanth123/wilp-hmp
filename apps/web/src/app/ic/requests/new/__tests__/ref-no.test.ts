import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@hmp/db';
import {
  createRequestWithRefNo,
  RefNoRetryExhausted,
} from '../ref-no';

type Created = { id: string; refNo: string };

function p2002(target: string[] | string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    `Unique constraint failed on ${Array.isArray(target) ? target.join(',') : target}`,
    { code: 'P2002', clientVersion: 'test', meta: { target } },
  );
}

function p2003(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('FK violation', {
    code: 'P2003',
    clientVersion: 'test',
    meta: { field_name: 'courseOfferingId' },
  });
}

function mockClient(opts: {
  /** Most recent refNo to return from findFirst (null = none yet). */
  lastRefNos: (string | null)[];
  /** Sequence of create outcomes: throw an error or resolve to a row. */
  createBehaviors: Array<{ kind: 'throw'; err: unknown } | { kind: 'resolve'; row: Created }>;
}) {
  const findFirst = vi.fn();
  for (const r of opts.lastRefNos) {
    findFirst.mockResolvedValueOnce(r === null ? null : { refNo: r });
  }
  const create = vi.fn();
  for (const b of opts.createBehaviors) {
    if (b.kind === 'throw') create.mockRejectedValueOnce(b.err);
    else create.mockResolvedValueOnce(b.row);
  }
  return {
    client: { handoutRequest: { findFirst, create } } as never,
    findFirst,
    create,
  };
}

describe('createRequestWithRefNo', () => {
  const input = {
    courseOfferingId: 'offering-1',
    initiatedById: 'user-1',
    notes: null,
    previousHandoutUrl: null,
    year: 2026,
  };

  it('returns HMP-YYYY-0001 on a fresh year', async () => {
    const { client, create } = mockClient({
      lastRefNos: [null],
      createBehaviors: [{ kind: 'resolve', row: { id: 'r1', refNo: 'HMP-2026-0001' } }],
    });
    const out = await createRequestWithRefNo(input, client);
    expect(out.refNo).toBe('HMP-2026-0001');
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![0].data.refNo).toBe('HMP-2026-0001');
  });

  it('retries on P2002 collisions and succeeds on the third attempt', async () => {
    // Concurrent IC creates: each retry re-reads the "last" row, which has
    // advanced because the other writer won.
    const { client, create, findFirst } = mockClient({
      lastRefNos: [{ refNo: 'HMP-2026-0001' } as never, { refNo: 'HMP-2026-0002' } as never, { refNo: 'HMP-2026-0002' } as never],
      createBehaviors: [
        { kind: 'throw', err: p2002(['refNo']) },
        { kind: 'throw', err: p2002(['refNo']) },
        { kind: 'resolve', row: { id: 'r3', refNo: 'HMP-2026-0003' } },
      ],
    });
    // Re-wire findFirst to return real values (mockClient typed `null` only).
    findFirst.mockReset();
    findFirst
      .mockResolvedValueOnce({ refNo: 'HMP-2026-0000' })
      .mockResolvedValueOnce({ refNo: 'HMP-2026-0001' })
      .mockResolvedValueOnce({ refNo: 'HMP-2026-0002' });

    const out = await createRequestWithRefNo(input, client);
    expect(out.refNo).toBe('HMP-2026-0003');
    expect(create).toHaveBeenCalledTimes(3);
    expect(create.mock.calls[0]![0].data.refNo).toBe('HMP-2026-0001');
    expect(create.mock.calls[1]![0].data.refNo).toBe('HMP-2026-0002');
    expect(create.mock.calls[2]![0].data.refNo).toBe('HMP-2026-0003');
  });

  it('throws RefNoRetryExhausted after 5 consecutive P2002 failures', async () => {
    const errs = Array.from({ length: 5 }, () => ({ kind: 'throw' as const, err: p2002(['refNo']) }));
    const { client, create } = mockClient({
      lastRefNos: Array(5).fill({ refNo: 'HMP-2026-0001' } as never),
      createBehaviors: errs,
    });
    // findFirst must be re-wired (mockClient encoded nulls only).
    const ff = client.handoutRequest.findFirst as ReturnType<typeof vi.fn>;
    ff.mockReset();
    for (let i = 0; i < 5; i++) ff.mockResolvedValueOnce({ refNo: 'HMP-2026-0001' });

    await expect(createRequestWithRefNo(input, client)).rejects.toBeInstanceOf(
      RefNoRetryExhausted,
    );
    expect(create).toHaveBeenCalledTimes(5);
  });

  it('does NOT retry on non-P2002 errors (FK violation propagates immediately)', async () => {
    const { client, create } = mockClient({
      lastRefNos: [null],
      createBehaviors: [{ kind: 'throw', err: p2003() }],
    });
    await expect(createRequestWithRefNo(input, client)).rejects.toMatchObject({ code: 'P2003' });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on P2002 for an unrelated unique field (e.g. email)', async () => {
    // Future-proofing: if someone adds @unique to another column, that error
    // must surface, not be retried.
    const { client, create } = mockClient({
      lastRefNos: [null],
      createBehaviors: [{ kind: 'throw', err: p2002(['email']) }],
    });
    await expect(createRequestWithRefNo(input, client)).rejects.toMatchObject({ code: 'P2002' });
    expect(create).toHaveBeenCalledTimes(1);
  });
});

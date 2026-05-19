import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@hmp/db';
import { createRequestWithRefNo, RefNoRetryExhausted } from '../ref-no';

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

/**
 * Builds a stub `Prisma.TransactionClient` whose `handoutRequest.findFirst`
 * and `handoutRequest.create` are vi.fn() mocks. Caller wires per-call
 * behavior with `.mockResolvedValueOnce` / `.mockRejectedValueOnce`.
 */
function mockClient() {
  const findFirst = vi.fn();
  const create = vi.fn();
  const client = {
    handoutRequest: { findFirst, create },
  } as unknown as Prisma.TransactionClient;
  return { client, findFirst, create };
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
    const { client, findFirst, create } = mockClient();
    findFirst.mockResolvedValueOnce(null);
    create.mockResolvedValueOnce({ id: 'r1', refNo: 'HMP-2026-0001' } satisfies Created);

    const out = await createRequestWithRefNo(input, client);
    expect(out.refNo).toBe('HMP-2026-0001');
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![0].data.refNo).toBe('HMP-2026-0001');
  });

  it('retries on P2002 collisions and succeeds on the third attempt', async () => {
    const { client, findFirst, create } = mockClient();
    findFirst
      .mockResolvedValueOnce({ refNo: 'HMP-2026-0000' })
      .mockResolvedValueOnce({ refNo: 'HMP-2026-0001' })
      .mockResolvedValueOnce({ refNo: 'HMP-2026-0002' });
    create
      .mockRejectedValueOnce(p2002(['refNo']))
      .mockRejectedValueOnce(p2002(['refNo']))
      .mockResolvedValueOnce({ id: 'r3', refNo: 'HMP-2026-0003' });

    const out = await createRequestWithRefNo(input, client);
    expect(out.refNo).toBe('HMP-2026-0003');
    expect(create).toHaveBeenCalledTimes(3);
    expect(create.mock.calls[0]![0].data.refNo).toBe('HMP-2026-0001');
    expect(create.mock.calls[1]![0].data.refNo).toBe('HMP-2026-0002');
    expect(create.mock.calls[2]![0].data.refNo).toBe('HMP-2026-0003');
  });

  it('throws RefNoRetryExhausted after 5 consecutive P2002 failures', async () => {
    const { client, findFirst, create } = mockClient();
    for (let i = 0; i < 5; i++) findFirst.mockResolvedValueOnce({ refNo: 'HMP-2026-0001' });
    for (let i = 0; i < 5; i++) create.mockRejectedValueOnce(p2002(['refNo']));

    await expect(createRequestWithRefNo(input, client)).rejects.toBeInstanceOf(
      RefNoRetryExhausted,
    );
    expect(create).toHaveBeenCalledTimes(5);
  });

  it('does NOT retry on non-P2002 errors (FK violation propagates immediately)', async () => {
    const { client, findFirst, create } = mockClient();
    findFirst.mockResolvedValueOnce(null);
    create.mockRejectedValueOnce(p2003());

    await expect(createRequestWithRefNo(input, client)).rejects.toMatchObject({ code: 'P2003' });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on P2002 for an unrelated unique field (e.g. email)', async () => {
    // Future-proofing: if someone adds @unique to another column, that error
    // must surface, not be retried.
    const { client, findFirst, create } = mockClient();
    findFirst.mockResolvedValueOnce(null);
    create.mockRejectedValueOnce(p2002(['email']));

    await expect(createRequestWithRefNo(input, client)).rejects.toMatchObject({ code: 'P2002' });
    expect(create).toHaveBeenCalledTimes(1);
  });
});

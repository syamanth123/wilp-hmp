import { describe, it, expect, vi } from 'vitest';
import { SmeNominationStatus, type Prisma } from '@hmp/db';
import {
  acceptNomination,
  declineNomination,
  completeNomination,
  SmeResponseError,
} from '../sme-response';

/**
 * Mocks the `Prisma.TransactionClient` delegates each helper touches. The
 * full client is too wide to stub safely; we only need the four entities
 * the SME-response helpers actually read or write.
 */
function mockClient(
  overrides: Partial<{
    nomination:
      | {
          id: string;
          status: SmeNominationStatus;
          smeUserId: string;
          requestId: string;
          notes: string | null;
        }
      | null;
    handout: { id: string } | null;
    myComment: { id: string } | null;
  }> = {},
) {
  const smeNominationFindUnique = vi.fn().mockResolvedValue(
    overrides.nomination === undefined
      ? {
          id: 'nom-1',
          status: SmeNominationStatus.PENDING,
          smeUserId: 'sme-1',
          requestId: 'req-1',
          notes: null,
        }
      : overrides.nomination,
  );
  const smeNominationUpdate = vi.fn().mockResolvedValue({ id: 'nom-1' });
  const handoutFindUnique = vi
    .fn()
    .mockResolvedValue(overrides.handout === undefined ? { id: 'h-1' } : overrides.handout);
  const commentFindFirst = vi
    .fn()
    .mockResolvedValue(overrides.myComment === undefined ? { id: 'c-1' } : overrides.myComment);
  const auditLogCreate = vi.fn().mockResolvedValue({});

  const client = {
    smeNomination: { findUnique: smeNominationFindUnique, update: smeNominationUpdate },
    handout: { findUnique: handoutFindUnique },
    comment: { findFirst: commentFindFirst },
    auditLog: { create: auditLogCreate },
  } as unknown as Prisma.TransactionClient;

  return {
    client,
    smeNominationFindUnique,
    smeNominationUpdate,
    handoutFindUnique,
    commentFindFirst,
    auditLogCreate,
  };
}

describe('acceptNomination', () => {
  it('marks PENDING → ACCEPTED + writes audit row + returns { id, status }', async () => {
    const { client, smeNominationUpdate, auditLogCreate } = mockClient();
    const result = await acceptNomination(
      { nominationId: 'nom-1', smeUserId: 'sme-1' },
      client,
    );
    expect(result).toEqual({ id: 'nom-1', status: SmeNominationStatus.ACCEPTED });

    expect(smeNominationUpdate).toHaveBeenCalledTimes(1);
    expect(smeNominationUpdate.mock.calls[0]![0].data).toMatchObject({
      status: SmeNominationStatus.ACCEPTED,
      respondedAt: expect.any(Date),
    });

    expect(auditLogCreate).toHaveBeenCalledTimes(1);
    const audit = auditLogCreate.mock.calls[0]![0].data;
    expect(audit.action).toBe('sme.accepted');
    expect(audit.entity).toBe('SmeNomination');
    expect(audit.entityId).toBe('nom-1');
    expect(audit.actorId).toBe('sme-1');
    expect(audit.requestId).toBe('req-1');
    expect(audit.after).toMatchObject({ status: SmeNominationStatus.ACCEPTED });
  });

  it('rejects when nomination not found (distinct "not found" message)', async () => {
    const { client, smeNominationUpdate } = mockClient({ nomination: null });
    await expect(
      acceptNomination({ nominationId: 'nom-x', smeUserId: 'sme-1' }, client),
    ).rejects.toMatchObject({ name: 'SmeResponseError', message: 'Nomination not found' });
    expect(smeNominationUpdate).not.toHaveBeenCalled();
  });

  it('rejects when nomination belongs to a different SME (distinct ownership message)', async () => {
    const { client, smeNominationUpdate } = mockClient({
      nomination: {
        id: 'nom-1',
        status: SmeNominationStatus.PENDING,
        smeUserId: 'someone-else',
        requestId: 'req-1',
        notes: null,
      },
    });
    await expect(
      acceptNomination({ nominationId: 'nom-1', smeUserId: 'sme-1' }, client),
    ).rejects.toMatchObject({
      name: 'SmeResponseError',
      message: 'This nomination is not assigned to you',
    });
    expect(smeNominationUpdate).not.toHaveBeenCalled();
  });

  it('rejects when status is ACCEPTED already (distinct status message)', async () => {
    const { client, smeNominationUpdate } = mockClient({
      nomination: {
        id: 'nom-1',
        status: SmeNominationStatus.ACCEPTED,
        smeUserId: 'sme-1',
        requestId: 'req-1',
        notes: null,
      },
    });
    await expect(
      acceptNomination({ nominationId: 'nom-1', smeUserId: 'sme-1' }, client),
    ).rejects.toThrowError(/Cannot accept a nomination in status ACCEPTED/);
    expect(smeNominationUpdate).not.toHaveBeenCalled();
  });
});

describe('declineNomination', () => {
  it('marks PENDING → DECLINED + appends [DECLINED] reason to notes + writes audit', async () => {
    const { client, smeNominationUpdate, auditLogCreate } = mockClient({
      nomination: {
        id: 'nom-1',
        status: SmeNominationStatus.PENDING,
        smeUserId: 'sme-1',
        requestId: 'req-1',
        notes: 'Context from the PC.',
      },
    });
    const result = await declineNomination(
      { nominationId: 'nom-1', smeUserId: 'sme-1', reason: 'Out on sabbatical' },
      client,
    );
    expect(result).toEqual({ id: 'nom-1', status: SmeNominationStatus.DECLINED });

    expect(smeNominationUpdate).toHaveBeenCalledTimes(1);
    const updateData = smeNominationUpdate.mock.calls[0]![0].data;
    expect(updateData.status).toBe(SmeNominationStatus.DECLINED);
    expect(updateData.respondedAt).toBeInstanceOf(Date);
    expect(updateData.notes).toBe('Context from the PC.\n\n[DECLINED] Out on sabbatical');

    const audit = auditLogCreate.mock.calls[0]![0].data;
    expect(audit.action).toBe('sme.declined');
    expect(audit.after).toMatchObject({
      status: SmeNominationStatus.DECLINED,
      reason: 'Out on sabbatical',
    });
  });

  it('handles null prior notes (appends with no leading content)', async () => {
    const { client, smeNominationUpdate } = mockClient({
      nomination: {
        id: 'nom-1',
        status: SmeNominationStatus.PENDING,
        smeUserId: 'sme-1',
        requestId: 'req-1',
        notes: null,
      },
    });
    await declineNomination(
      { nominationId: 'nom-1', smeUserId: 'sme-1', reason: 'Topic outside expertise' },
      client,
    );
    expect(smeNominationUpdate.mock.calls[0]![0].data.notes).toBe(
      '\n\n[DECLINED] Topic outside expertise',
    );
  });

  it('rejects decline on non-PENDING status (distinct message)', async () => {
    const { client, smeNominationUpdate } = mockClient({
      nomination: {
        id: 'nom-1',
        status: SmeNominationStatus.COMPLETED,
        smeUserId: 'sme-1',
        requestId: 'req-1',
        notes: null,
      },
    });
    await expect(
      declineNomination(
        { nominationId: 'nom-1', smeUserId: 'sme-1', reason: 'Whatever' },
        client,
      ),
    ).rejects.toThrowError(/Cannot decline a nomination in status COMPLETED/);
    expect(smeNominationUpdate).not.toHaveBeenCalled();
  });

  it('rejects decline when not the owning SME (distinct ownership message)', async () => {
    const { client, smeNominationUpdate } = mockClient({
      nomination: {
        id: 'nom-1',
        status: SmeNominationStatus.PENDING,
        smeUserId: 'someone-else',
        requestId: 'req-1',
        notes: null,
      },
    });
    await expect(
      declineNomination(
        { nominationId: 'nom-1', smeUserId: 'sme-1', reason: 'Whatever' },
        client,
      ),
    ).rejects.toMatchObject({ message: 'This nomination is not assigned to you' });
    expect(smeNominationUpdate).not.toHaveBeenCalled();
  });
});

describe('completeNomination', () => {
  it('marks ACCEPTED → COMPLETED when SME has commented + writes audit', async () => {
    const { client, smeNominationUpdate, auditLogCreate } = mockClient({
      nomination: {
        id: 'nom-1',
        status: SmeNominationStatus.ACCEPTED,
        smeUserId: 'sme-1',
        requestId: 'req-1',
        notes: null,
      },
    });
    const result = await completeNomination(
      { nominationId: 'nom-1', smeUserId: 'sme-1' },
      client,
    );
    expect(result).toEqual({ id: 'nom-1', status: SmeNominationStatus.COMPLETED });

    expect(smeNominationUpdate.mock.calls[0]![0].data).toMatchObject({
      status: SmeNominationStatus.COMPLETED,
      completedAt: expect.any(Date),
    });

    const audit = auditLogCreate.mock.calls[0]![0].data;
    expect(audit.action).toBe('sme.completed');
    expect(audit.after).toMatchObject({ status: SmeNominationStatus.COMPLETED });
  });

  it('rejects complete on non-ACCEPTED status (distinct message)', async () => {
    const { client, smeNominationUpdate } = mockClient({
      nomination: {
        id: 'nom-1',
        status: SmeNominationStatus.PENDING,
        smeUserId: 'sme-1',
        requestId: 'req-1',
        notes: null,
      },
    });
    await expect(
      completeNomination({ nominationId: 'nom-1', smeUserId: 'sme-1' }, client),
    ).rejects.toThrowError(/Cannot mark complete a nomination in status PENDING/);
    expect(smeNominationUpdate).not.toHaveBeenCalled();
  });

  it('rejects complete when no handout exists yet (distinct message)', async () => {
    const { client, smeNominationUpdate } = mockClient({
      nomination: {
        id: 'nom-1',
        status: SmeNominationStatus.ACCEPTED,
        smeUserId: 'sme-1',
        requestId: 'req-1',
        notes: null,
      },
      handout: null,
    });
    await expect(
      completeNomination({ nominationId: 'nom-1', smeUserId: 'sme-1' }, client),
    ).rejects.toThrowError(/faculty has not started editing/);
    expect(smeNominationUpdate).not.toHaveBeenCalled();
  });

  it('rejects complete when handout exists but SME has no comment yet (distinct message)', async () => {
    const { client, smeNominationUpdate } = mockClient({
      nomination: {
        id: 'nom-1',
        status: SmeNominationStatus.ACCEPTED,
        smeUserId: 'sme-1',
        requestId: 'req-1',
        notes: null,
      },
      myComment: null,
    });
    await expect(
      completeNomination({ nominationId: 'nom-1', smeUserId: 'sme-1' }, client),
    ).rejects.toThrowError(/Add at least one comment with your advisory input/);
    expect(smeNominationUpdate).not.toHaveBeenCalled();
  });

  it('rejects complete when nomination belongs to another SME (distinct ownership message)', async () => {
    const { client, smeNominationUpdate } = mockClient({
      nomination: {
        id: 'nom-1',
        status: SmeNominationStatus.ACCEPTED,
        smeUserId: 'someone-else',
        requestId: 'req-1',
        notes: null,
      },
    });
    await expect(
      completeNomination({ nominationId: 'nom-1', smeUserId: 'sme-1' }, client),
    ).rejects.toMatchObject({ message: 'This nomination is not assigned to you' });
    expect(smeNominationUpdate).not.toHaveBeenCalled();
  });
});

describe('SmeResponseError', () => {
  it('is an Error subclass with name "SmeResponseError"', () => {
    const e = new SmeResponseError('test');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('SmeResponseError');
    expect(e.message).toBe('test');
  });
});

import { describe, it, expect, vi } from 'vitest';
import { HandoutStatus, RoleName, SmeNominationStatus, type Prisma } from '@hmp/db';
import { createSmeNomination, NominationError } from '../sme-nomination';

/**
 * Builds a stub `Prisma.TransactionClient` whose only-needed properties are
 * the four delegates `createSmeNomination` touches. Each method is a
 * vi.fn() the test wires per-call.
 */
function mockClient(overrides: Partial<{
  request: { id: string; status: HandoutStatus } | null;
  sme:
    | {
        id: string;
        active: boolean;
        roles: { role: { name: RoleName } }[];
      }
    | null;
  duplicate: { id: string } | null;
}> = {}) {
  const requestFindUnique = vi.fn().mockResolvedValue(
    overrides.request === undefined
      ? { id: 'req-1', status: HandoutStatus.ASSIGNED }
      : overrides.request,
  );
  const userFindUnique = vi.fn().mockResolvedValue(
    overrides.sme === undefined
      ? { id: 'sme-1', active: true, roles: [{ role: { name: RoleName.SME } }] }
      : overrides.sme,
  );
  const smeNominationFindFirst = vi.fn().mockResolvedValue(
    overrides.duplicate === undefined ? null : overrides.duplicate,
  );
  const smeNominationCreate = vi.fn().mockResolvedValue({ id: 'nom-1' });
  const auditLogCreate = vi.fn().mockResolvedValue({});

  const client = {
    handoutRequest: { findUnique: requestFindUnique },
    user: { findUnique: userFindUnique },
    smeNomination: { findFirst: smeNominationFindFirst, create: smeNominationCreate },
    auditLog: { create: auditLogCreate },
  } as unknown as Prisma.TransactionClient;

  return {
    client,
    requestFindUnique,
    userFindUnique,
    smeNominationFindFirst,
    smeNominationCreate,
    auditLogCreate,
  };
}

const input = {
  requestId: 'req-1',
  smeUserId: 'sme-1',
  nominatedById: 'pc-1',
  topic: 'Industry perspective on architectures',
  notes: null,
};

describe('createSmeNomination', () => {
  it('creates a nomination + audit row on the happy path (returns { id })', async () => {
    const { client, smeNominationCreate, auditLogCreate } = mockClient();
    const result = await createSmeNomination(input, client);
    expect(result).toEqual({ id: 'nom-1' });

    expect(smeNominationCreate).toHaveBeenCalledTimes(1);
    expect(smeNominationCreate.mock.calls[0]![0].data).toMatchObject({
      requestId: 'req-1',
      smeUserId: 'sme-1',
      nominatedById: 'pc-1',
      topic: 'Industry perspective on architectures',
      notes: null,
      status: SmeNominationStatus.PENDING,
    });

    expect(auditLogCreate).toHaveBeenCalledTimes(1);
    const auditData = auditLogCreate.mock.calls[0]![0].data;
    expect(auditData.action).toBe('sme.nominated');
    expect(auditData.entity).toBe('SmeNomination');
    expect(auditData.entityId).toBe('nom-1');
    expect(auditData.actorId).toBe('pc-1');
    expect(auditData.requestId).toBe('req-1');
    // No `before` field — create-style audit, matches convention from
    // apps/web/src/lib/audit.ts (helper defaults to null when omitted).
    expect(auditData.before).toBeUndefined();
    expect(auditData.after).toMatchObject({
      smeUserId: 'sme-1',
      topic: 'Industry perspective on architectures',
      notes: null,
    });
  });

  it('rejects when an active PENDING nomination already exists for the same (request, SME)', async () => {
    const { client, smeNominationCreate, auditLogCreate } = mockClient({
      duplicate: { id: 'existing-nom' },
    });
    await expect(createSmeNomination(input, client)).rejects.toBeInstanceOf(NominationError);
    expect(smeNominationCreate).not.toHaveBeenCalled();
    expect(auditLogCreate).not.toHaveBeenCalled();
  });

  it('rejects when the request is in a status that does not accept nominations (e.g. DRAFT)', async () => {
    const { client, smeNominationCreate } = mockClient({
      request: { id: 'req-1', status: HandoutStatus.DRAFT },
    });
    await expect(createSmeNomination(input, client)).rejects.toThrowError(
      /Cannot nominate from status DRAFT/,
    );
    expect(smeNominationCreate).not.toHaveBeenCalled();
  });

  it('rejects when the chosen user does not have the SME role', async () => {
    const { client, smeNominationCreate } = mockClient({
      sme: { id: 'sme-1', active: true, roles: [{ role: { name: RoleName.FACULTY } }] },
    });
    await expect(createSmeNomination(input, client)).rejects.toThrowError(
      /does not have the SME role/,
    );
    expect(smeNominationCreate).not.toHaveBeenCalled();
  });

  it('rejects when the SME user is inactive', async () => {
    const { client, smeNominationCreate } = mockClient({
      sme: { id: 'sme-1', active: false, roles: [{ role: { name: RoleName.SME } }] },
    });
    await expect(createSmeNomination(input, client)).rejects.toThrowError(
      /SME user is inactive/,
    );
    expect(smeNominationCreate).not.toHaveBeenCalled();
  });

  it('rejects when the request does not exist', async () => {
    const { client, smeNominationCreate } = mockClient({ request: null });
    await expect(createSmeNomination(input, client)).rejects.toThrowError(/Request not found/);
    expect(smeNominationCreate).not.toHaveBeenCalled();
  });

  it('rejects when the SME user does not exist', async () => {
    const { client, smeNominationCreate } = mockClient({ sme: null });
    await expect(createSmeNomination(input, client)).rejects.toThrowError(/SME user not found/);
    expect(smeNominationCreate).not.toHaveBeenCalled();
  });

  it('allows ASSIGNED, IN_PROGRESS, SUBMITTED, UNDER_REVIEW, REWORK_REQUESTED statuses', async () => {
    const allowed = [
      HandoutStatus.ASSIGNED,
      HandoutStatus.IN_PROGRESS,
      HandoutStatus.SUBMITTED,
      HandoutStatus.UNDER_REVIEW,
      HandoutStatus.REWORK_REQUESTED,
    ] as const;
    for (const status of allowed) {
      const { client, smeNominationCreate } = mockClient({
        request: { id: 'req-1', status },
      });
      await expect(createSmeNomination(input, client)).resolves.toEqual({ id: 'nom-1' });
      expect(smeNominationCreate).toHaveBeenCalledTimes(1);
    }
  });
});

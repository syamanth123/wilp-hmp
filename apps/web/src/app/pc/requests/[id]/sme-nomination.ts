import {
  prisma,
  HandoutStatus,
  RoleName,
  SmeNominationStatus,
  type Prisma,
} from '@hmp/db';

/**
 * Statuses in which a HandoutRequest can accept new SME nominations.
 * Pre-allocation states (DRAFT, REQUESTED, ALLOCATED) have no faculty to
 * advise yet; terminal states (APPROVED, PUBLISHED, ARCHIVED, REJECTED) are
 * past the point where advisory input is actionable.
 */
const NOMINATION_ALLOWED_STATUSES = new Set<HandoutStatus>([
  HandoutStatus.ASSIGNED,
  HandoutStatus.IN_PROGRESS,
  HandoutStatus.SUBMITTED,
  HandoutStatus.UNDER_REVIEW,
  HandoutStatus.REWORK_REQUESTED,
]);

/**
 * Thrown by `createSmeNomination` for any business-rule violation
 * (status not allowed, SME inactive, duplicate, etc). The server action
 * catches this and converts it to a `{ error: string }` return value.
 */
export class NominationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NominationError';
  }
}

export interface CreateSmeNominationInput {
  requestId: string;
  smeUserId: string;
  nominatedById: string;
  topic: string;
  notes: string | null;
}

type PrismaLike = Prisma.TransactionClient | typeof prisma;

/**
 * Atomically validates + creates an SmeNomination row plus its AuditLog entry.
 *
 * All checks happen on `client` (the passed Prisma context). When `client` is
 * a `Prisma.TransactionClient`, every read and write — including the
 * duplicate guard — sees the same snapshot, so two concurrent PCs nominating
 * the same SME on the same request cannot both pass the duplicate check.
 * (A future hardening step is a partial unique index on
 * `(requestId, smeUserId) WHERE status IN ('PENDING','ACCEPTED')`; for now
 * the in-txn check is sufficient at current concurrency.)
 *
 * Throws `NominationError` on validation failure. Other errors (DB down,
 * etc.) propagate normally.
 */
export async function createSmeNomination(
  input: CreateSmeNominationInput,
  client: PrismaLike = prisma,
): Promise<{ id: string }> {
  // 1. Request must exist + be in a nomination-accepting status.
  const request = await client.handoutRequest.findUnique({
    where: { id: input.requestId },
    select: { id: true, status: true },
  });
  if (!request) throw new NominationError('Request not found');
  if (!NOMINATION_ALLOWED_STATUSES.has(request.status)) {
    throw new NominationError(`Cannot nominate from status ${request.status}`);
  }

  // 2. SME user must exist, be active, and actually have the SME role.
  const sme = await client.user.findUnique({
    where: { id: input.smeUserId },
    select: {
      id: true,
      active: true,
      roles: { select: { role: { select: { name: true } } } },
    },
  });
  if (!sme) throw new NominationError('SME user not found');
  if (!sme.active) throw new NominationError('SME user is inactive');
  if (!sme.roles.some((r) => r.role.name === RoleName.SME)) {
    throw new NominationError('Selected user does not have the SME role');
  }

  // 3. Duplicate guard — IN the same txn so concurrent nominations can't
  //    both pass. PENDING and ACCEPTED are the live states; DECLINED and
  //    COMPLETED don't block a re-nomination (the SME has either refused
  //    or already finished — a fresh nomination is intentional in that case).
  const dup = await client.smeNomination.findFirst({
    where: {
      requestId: input.requestId,
      smeUserId: input.smeUserId,
      status: { in: [SmeNominationStatus.PENDING, SmeNominationStatus.ACCEPTED] },
    },
    select: { id: true },
  });
  if (dup) {
    throw new NominationError(
      'This SME is already nominated for this request (PENDING or ACCEPTED). Wait for it to be declined or completed.',
    );
  }

  // 4. Create the nomination + audit row in the same txn so they're atomic.
  const nomination = await client.smeNomination.create({
    data: {
      requestId: input.requestId,
      smeUserId: input.smeUserId,
      nominatedById: input.nominatedById,
      topic: input.topic,
      notes: input.notes,
      status: SmeNominationStatus.PENDING,
    },
    select: { id: true },
  });
  await client.auditLog.create({
    data: {
      actorId: input.nominatedById,
      action: 'sme.nominated',
      entity: 'SmeNomination',
      entityId: nomination.id,
      // No `before` — this is a create with no prior state. The AuditLog
      // column is nullable; Prisma writes null when the field is omitted.
      // Matches the pattern in apps/web/src/lib/audit.ts (its `audit()`
      // helper defaults `before` to null via `?? null`).
      after: {
        smeUserId: input.smeUserId,
        topic: input.topic,
        notes: input.notes,
      } as never,
      requestId: input.requestId,
    },
  });

  return nomination;
}

export { NOMINATION_ALLOWED_STATUSES };

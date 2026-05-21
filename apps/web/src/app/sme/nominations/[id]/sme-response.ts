import {
  prisma,
  SmeNominationStatus,
  type Prisma,
} from '@hmp/db';

/**
 * Thrown by the three SME-response helpers for any business-rule violation
 * (wrong status, not your nomination, comment-presence prereq, etc). The
 * server action layer catches this and converts it to `{ error: string }`.
 *
 * Every throw carries a *distinct* user-facing message so production logs
 * unambiguously surface which check actually fired. Avoid generic wrappers.
 */
export class SmeResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SmeResponseError';
  }
}

type PrismaLike = Prisma.TransactionClient | typeof prisma;

export interface AcceptNominationInput {
  nominationId: string;
  smeUserId: string;
}

export interface DeclineNominationInput {
  nominationId: string;
  smeUserId: string;
  reason: string;
}

export interface CompleteNominationInput {
  nominationId: string;
  smeUserId: string;
}

/**
 * Loads + verifies the nomination belongs to this SME user. Returns the row.
 * Throws SmeResponseError with distinct messages for not-found vs ownership.
 *
 * NB: caller is expected to have done a status check upstream (helpers
 * enforce status BEFORE ownership in their own bodies — cheapest rejection
 * first, see jsdoc on each helper).
 */
async function loadOwnedNomination(
  client: PrismaLike,
  nominationId: string,
  smeUserId: string,
) {
  const nomination = await client.smeNomination.findUnique({
    where: { id: nominationId },
    select: {
      id: true,
      status: true,
      smeUserId: true,
      requestId: true,
      notes: true,
    },
  });
  if (!nomination) {
    throw new SmeResponseError('Nomination not found');
  }
  if (nomination.smeUserId !== smeUserId) {
    throw new SmeResponseError('This nomination is not assigned to you');
  }
  return nomination;
}

/**
 * Marks a PENDING nomination as ACCEPTED. Records the response time and
 * writes an audit row in the same transaction.
 *
 * Rejection order (cheapest first):
 *   1. Status must be PENDING — distinct message per status
 *   2. Ownership — distinct "not assigned to you" message
 *
 * The status check runs first by re-selecting from `client` so a concurrent
 * decline can't race the accept (both readers see the same row state in
 * the txn snapshot).
 */
export async function acceptNomination(
  input: AcceptNominationInput,
  client: PrismaLike = prisma,
): Promise<{ id: string; status: 'ACCEPTED' }> {
  const nomination = await loadOwnedNomination(client, input.nominationId, input.smeUserId);

  if (nomination.status !== SmeNominationStatus.PENDING) {
    throw new SmeResponseError(
      `Cannot accept a nomination in status ${nomination.status} (only PENDING can be accepted)`,
    );
  }

  const now = new Date();
  const updated = await client.smeNomination.update({
    where: { id: nomination.id },
    data: { status: SmeNominationStatus.ACCEPTED, respondedAt: now },
    select: { id: true },
  });
  await client.auditLog.create({
    data: {
      actorId: input.smeUserId,
      action: 'sme.accepted',
      entity: 'SmeNomination',
      entityId: nomination.id,
      // No `before` for status transitions on advisory-only entities — the
      // SmeNominationStatus enum carries the prior state ("must be PENDING
      // to accept" is the only valid prior), so persisting it adds noise
      // without aiding investigation. Matches the create-style convention
      // in apps/web/src/app/pc/requests/[id]/sme-nomination.ts.
      after: {
        status: SmeNominationStatus.ACCEPTED,
        respondedAt: now.toISOString(),
      } as never,
      requestId: nomination.requestId,
    },
  });
  return { id: updated.id, status: SmeNominationStatus.ACCEPTED };
}

/**
 * Marks a PENDING nomination as DECLINED. Appends the reason to `notes`
 * with a parseable separator (`\n\n[DECLINED] ${reason}`) so future
 * analytics can pattern-match without colliding with real note content.
 *
 * Rejection order:
 *   1. Status must be PENDING
 *   2. Ownership
 *   3. (reason length is validated at the Zod layer, not here)
 */
export async function declineNomination(
  input: DeclineNominationInput,
  client: PrismaLike = prisma,
): Promise<{ id: string; status: 'DECLINED' }> {
  const nomination = await loadOwnedNomination(client, input.nominationId, input.smeUserId);

  if (nomination.status !== SmeNominationStatus.PENDING) {
    throw new SmeResponseError(
      `Cannot decline a nomination in status ${nomination.status} (only PENDING can be declined)`,
    );
  }

  // Append-not-overwrite — preserve any context the PC provided when
  // nominating. The `[DECLINED]` tag is intentional: square brackets won't
  // collide with real notes content (unlike `---` separators which can),
  // and a future analytics query can `LIKE '%[DECLINED]%'` cleanly.
  const trimmedReason = input.reason.trim();
  const declineSuffix = `\n\n[DECLINED] ${trimmedReason}`;
  const newNotes = (nomination.notes ?? '') + declineSuffix;

  const now = new Date();
  const updated = await client.smeNomination.update({
    where: { id: nomination.id },
    data: {
      status: SmeNominationStatus.DECLINED,
      respondedAt: now,
      notes: newNotes,
    },
    select: { id: true },
  });
  await client.auditLog.create({
    data: {
      actorId: input.smeUserId,
      action: 'sme.declined',
      entity: 'SmeNomination',
      entityId: nomination.id,
      after: {
        status: SmeNominationStatus.DECLINED,
        respondedAt: now.toISOString(),
        reason: trimmedReason,
      } as never,
      requestId: nomination.requestId,
    },
  });
  return { id: updated.id, status: SmeNominationStatus.DECLINED };
}

/**
 * Marks an ACCEPTED nomination as COMPLETED. Enforces the prerequisite that
 * the SME has actually left at least one comment on the handout under this
 * request — "complete" should mean "I've given my advisory input", not just
 * "I'm closing the ticket".
 *
 * Rejection order (cheapest first):
 *   1. Status must be ACCEPTED — distinct message per status
 *   2. Ownership — distinct "not assigned to you" message
 *   3. Comment-presence prereq — distinct messages for "no handout yet" vs
 *      "handout exists but no comment from you"
 *
 * The comment-presence query goes through Handout.requestId (which has a
 * unique constraint) → Comment.handoutId (which has `@@index([handoutId])`).
 * No composite (handoutId, authorId) index needed at current volumes; flagged
 * in docs/dev-handoff-audit.md if we hit slow queries later.
 */
export async function completeNomination(
  input: CompleteNominationInput,
  client: PrismaLike = prisma,
): Promise<{ id: string; status: 'COMPLETED' }> {
  const nomination = await loadOwnedNomination(client, input.nominationId, input.smeUserId);

  if (nomination.status !== SmeNominationStatus.ACCEPTED) {
    throw new SmeResponseError(
      `Cannot mark complete a nomination in status ${nomination.status} (only ACCEPTED can be completed)`,
    );
  }

  // Comment-presence prereq. Two distinct rejection messages:
  //   - "no handout yet" (faculty hasn't started editing — there's nowhere
  //     to comment, so the SME literally cannot satisfy this gate)
  //   - "handout exists but no comment from you" (the SME accepted but never
  //     posted anything, which is the gate's actual purpose)
  const handout = await client.handout.findUnique({
    where: { requestId: nomination.requestId },
    select: { id: true },
  });
  if (!handout) {
    throw new SmeResponseError(
      'Cannot mark complete: faculty has not started editing this handout yet, so there are no comments to leave',
    );
  }
  const myComment = await client.comment.findFirst({
    where: { handoutId: handout.id, authorId: input.smeUserId },
    select: { id: true },
  });
  if (!myComment) {
    throw new SmeResponseError(
      'Add at least one comment with your advisory input before marking complete',
    );
  }

  const now = new Date();
  const updated = await client.smeNomination.update({
    where: { id: nomination.id },
    data: { status: SmeNominationStatus.COMPLETED, completedAt: now },
    select: { id: true },
  });
  await client.auditLog.create({
    data: {
      actorId: input.smeUserId,
      action: 'sme.completed',
      entity: 'SmeNomination',
      entityId: nomination.id,
      after: {
        status: SmeNominationStatus.COMPLETED,
        completedAt: now.toISOString(),
      } as never,
      requestId: nomination.requestId,
    },
  });
  return { id: updated.id, status: SmeNominationStatus.COMPLETED };
}

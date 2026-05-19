import { prisma, Prisma, HandoutStatus, type RoleName } from '@hmp/db';
import { nextStatus } from './machine';
import { assertRoleAllowed, WorkflowError } from './guards';
import type { WorkflowEvent } from './types';

export interface TransitionActor {
  id: string;
  roles: RoleName[];
}

export interface TransitionEffectCtx {
  requestId: string;
  handoutId: string;
  from: HandoutStatus;
  to: HandoutStatus;
  actor: TransitionActor;
}

export type TransitionEffect = (
  tx: Prisma.TransactionClient,
  ctx: TransitionEffectCtx,
) => Promise<void>;

export interface TransitionInput {
  requestId: string;
  event: WorkflowEvent['type'];
  actor: TransitionActor;
  /** Optional metadata persisted in the audit log. */
  meta?: Record<string, unknown>;
  /**
   * Optional side-effects (e.g. write FacultyAssignment, Approval) that run
   * inside the same DB transaction as the status update + audit write.
   * If this throws, the status change is rolled back.
   */
  effects?: TransitionEffect;
}

export interface TransitionResult {
  from: HandoutStatus;
  to: HandoutStatus;
  handoutId: string;
}

/**
 * DB-aware lifecycle transition.
 *  1. Load HandoutRequest (+ handout).
 *  2. Verify role + transition table.
 *  3. Atomically update HandoutRequest.status, Handout.status, run optional
 *     side-effects, and write AuditLog — all in one $transaction.
 *  4. Lazily create the Handout shell on the first transition out of DRAFT.
 */
export async function transition(input: TransitionInput): Promise<TransitionResult> {
  const { requestId, event, actor, meta, effects } = input;

  assertRoleAllowed(event, actor.roles);

  const request = await prisma.handoutRequest.findUnique({
    where: { id: requestId },
    include: { handout: true },
  });
  if (!request) {
    throw new WorkflowError('not_found', `HandoutRequest ${requestId} not found`);
  }

  const to = nextStatus(request.status, event);
  if (!to) {
    throw new WorkflowError(
      'invalid_transition',
      `Cannot ${event} from status ${request.status}`,
    );
  }

  const from = request.status;

  const result = await prisma.$transaction(async (tx) => {
    const updatedRequest = await tx.handoutRequest.update({
      where: { id: requestId },
      data: { status: to },
    });

    let handoutId = request.handout?.id;
    if (!handoutId) {
      const created = await tx.handout.create({
        data: { requestId, status: to },
      });
      handoutId = created.id;
    } else {
      await tx.handout.update({ where: { id: handoutId }, data: { status: to } });
    }

    if (effects) {
      await effects(tx, { requestId, handoutId: handoutId!, from, to, actor });
    }

    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        action: `handout.transition.${event}`,
        entity: 'HandoutRequest',
        entityId: requestId,
        before: { status: from } as never,
        after: { status: to, meta: meta ?? null } as never,
        requestId,
      },
    });

    return { handoutId: handoutId!, status: updatedRequest.status };
  });

  return { from, to: result.status, handoutId: result.handoutId };
}

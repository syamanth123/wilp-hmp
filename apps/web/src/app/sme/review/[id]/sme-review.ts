import { ApprovalStage, ApprovalDecision, type Prisma, type RoleName } from '@hmp/db';
import { transition, WorkflowError } from '@hmp/workflow';

/**
 * SME approval-workflow business logic (Prompt 12-a). Separated from the
 * server-action layer (auth + revalidate live in actions.ts) so the core
 * approve/revert behavior is integration-testable with a real actor object
 * and no NextAuth context — same split as createSmeNomination /
 * sme-response.ts.
 *
 * Both helpers drive `transition()`:
 *   - smeApprove: SME_REVIEW → SUBMITTED (SME_APPROVED event). PC's existing
 *     review queue. Writes Approval(stage=SME_REVIEW, decision=APPROVED).
 *   - smeRevert:  SME_REVIEW → REWORK_REQUESTED (SME_REVERTED event). Faculty's
 *     existing rework state. Writes Approval(stage=SME_REVIEW, decision=REWORK,
 *     comments) AND a Comment row on the handout so faculty sees the SME's
 *     feedback in the existing comment thread.
 *
 * The "is THIS sme the assigned SME for this request" check runs INSIDE the
 * transition's $transaction (via the effects callback) so it's atomic with
 * the status change — a throw rolls the whole thing back. The role check
 * (must hold the SME role at all) is handled upstream by transition()'s
 * assertRoleAllowed.
 */

export class SmeReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SmeReviewError';
  }
}

export interface SmeActor {
  id: string;
  roles: RoleName[];
}

/**
 * Verifies an SmeAssignment exists for `requestId` and is owned by
 * `smeUserId`. Throws SmeReviewError (distinct messages) otherwise. Reads
 * through the passed client so it sees the same snapshot as the surrounding
 * transaction when called inside effects.
 */
async function assertAssignedSme(
  client: Prisma.TransactionClient,
  requestId: string,
  smeUserId: string,
): Promise<void> {
  const assignment = await client.smeAssignment.findUnique({
    where: { requestId },
    select: { smeUserId: true },
  });
  if (!assignment) {
    throw new SmeReviewError('No SME is assigned to this handout');
  }
  if (assignment.smeUserId !== smeUserId) {
    throw new SmeReviewError('This handout is not assigned to you for SME review');
  }
}

/**
 * SME approves the handout. Transitions SME_REVIEW → SUBMITTED (PC's queue).
 * Throws WorkflowError (bad status / role) or SmeReviewError (not the
 * assigned SME). Caller (action layer) maps both to `{ error }`.
 */
export async function smeApprove(requestId: string, actor: SmeActor): Promise<void> {
  await transition({
    requestId,
    event: 'SME_APPROVED',
    actor,
    effects: async (tx) => {
      await assertAssignedSme(tx, requestId, actor.id);
      await tx.approval.create({
        data: {
          requestId,
          stage: ApprovalStage.SME_REVIEW,
          decision: ApprovalDecision.APPROVED,
          reviewerId: actor.id,
          decidedAt: new Date(),
        },
      });
    },
  });
}

/**
 * SME reverts the handout to faculty with a required comment. Transitions
 * SME_REVIEW → REWORK_REQUESTED. Writes the SME-review Approval row AND a
 * Comment on the handout (so faculty sees the feedback in the thread,
 * alongside any PC rework comments). `comments` must be non-empty — the
 * action layer validates, but we guard here too.
 */
export async function smeRevert(
  requestId: string,
  actor: SmeActor,
  comments: string,
): Promise<void> {
  const trimmed = comments.trim();
  if (!trimmed) {
    throw new SmeReviewError('A comment is required when reverting to faculty');
  }
  await transition({
    requestId,
    event: 'SME_REVERTED',
    actor,
    meta: { comments: trimmed },
    effects: async (tx, ctx) => {
      await assertAssignedSme(tx, requestId, actor.id);
      await tx.approval.create({
        data: {
          requestId,
          stage: ApprovalStage.SME_REVIEW,
          decision: ApprovalDecision.REWORK,
          reviewerId: actor.id,
          comments: trimmed,
          decidedAt: new Date(),
        },
      });
      // Surface the revert reason in the existing per-handout comment thread.
      await tx.comment.create({
        data: {
          handoutId: ctx.handoutId,
          authorId: actor.id,
          body: trimmed,
        },
      });
    },
  });
}

export { WorkflowError };

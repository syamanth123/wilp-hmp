import { ApprovalStage, ApprovalDecision } from '@hmp/db';
import type { TransitionEffect } from '@hmp/workflow';

/**
 * Shared transition effect for PC allocation reject (Prompt 22). Used by BOTH
 * the single action (pc/requests/[id]/actions.ts) and the bulk path
 * (pc/allocation-review/config.ts) so the destructive multi-step stays
 * byte-identical and can't drift.
 *
 * Clears HOG's allocation so re-allocation starts fresh:
 *  - FacultyAssignment → soft-deactivate (preserves history; keeps the
 *    per-semester cap count, which filters active=true, correct).
 *  - SmeAssignment → HARD-DELETE. It has no `active` field and requestId is
 *    @unique, so leaving it would block HOG's re-allocate (smeAssignment.create
 *    → unique violation). The rejected SME is still recoverable from the
 *    FACULTY_ALLOCATED audit row's meta.smeUserId. See docs/dev-handoff-audit.md §1.
 *  - Writes a PC_REVIEW / REWORK Approval carrying the reason (surfaced to HOG).
 */
export function rejectAllocationEffect(comment: string, actorId: string): TransitionEffect {
  return async (tx, ctx) => {
    await tx.facultyAssignment.updateMany({
      where: { requestId: ctx.requestId, active: true },
      data: { active: false },
    });
    await tx.smeAssignment.deleteMany({ where: { requestId: ctx.requestId } });
    await tx.approval.create({
      data: {
        requestId: ctx.requestId,
        stage: ApprovalStage.PC_REVIEW,
        decision: ApprovalDecision.REWORK,
        reviewerId: actorId,
        comments: comment,
        decidedAt: new Date(),
      },
    });
  };
}

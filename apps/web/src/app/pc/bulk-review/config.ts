import { ApprovalStage, ApprovalDecision } from '@hmp/db';
import { transition } from '@hmp/workflow';
import type { BulkReviewRoleConfig } from '@/lib/bulk-review';
import { HandoutStatus } from '@hmp/db';

// Plain (non-'use server') config module so both the server action and the
// integration test can import the role config. 'use server' files may only
// export async functions, which is why the config lives here.

// One source for the action→event map (shared by eventMap + executeRow).
const PC_EVENTS = { pc_approve: 'REVIEW_APPROVED', pc_rework: 'REVIEW_REWORK' } as const;

export const PC_CONFIG: BulkReviewRoleConfig = {
  queueStatus: HandoutStatus.SUBMITTED,
  allowedActions: ['pc_approve', 'pc_rework'],
  commentRequiredFor: ['pc_rework'],
  eventMap: PC_EVENTS,
  auditAction: 'pc_review.bulk',
  executeRow: async (action, requestId, comment, actor) => {
    const decision = action === 'pc_approve' ? ApprovalDecision.APPROVED : ApprovalDecision.REWORK;
    await transition({
      requestId,
      event: PC_EVENTS[action as keyof typeof PC_EVENTS],
      actor: { id: actor.id, roles: actor.roles },
      effects: async (tx) => {
        await tx.approval.create({
          data: {
            requestId,
            stage: ApprovalStage.PC_REVIEW,
            decision,
            reviewerId: actor.id,
            comments: comment || null,
            decidedAt: new Date(),
          },
        });
      },
    });
  },
};

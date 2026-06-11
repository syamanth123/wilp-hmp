import { HandoutStatus, ApprovalStage, ApprovalDecision } from '@hmp/db';
import { transition } from '@hmp/workflow';
import type { BulkReviewRoleConfig } from '@/lib/bulk-review';
import type { WorkflowEventType } from '@/lib/notifications';

// Per-action spec: workflow event + the Approval decision written at HOG_FINAL.
const HOG_ACTIONS: Record<string, { event: WorkflowEventType; decision: ApprovalDecision }> = {
  hog_final_approve: { event: 'FINAL_APPROVED', decision: ApprovalDecision.APPROVED },
  hog_reject: { event: 'FINAL_REJECTED', decision: ApprovalDecision.REJECTED },
  hog_rework: { event: 'REVIEW_REWORK', decision: ApprovalDecision.REWORK },
};

export const HOG_CONFIG: BulkReviewRoleConfig = {
  queueStatus: HandoutStatus.UNDER_REVIEW,
  allowedActions: Object.keys(HOG_ACTIONS),
  commentRequiredFor: ['hog_reject', 'hog_rework'],
  eventMap: Object.fromEntries(Object.entries(HOG_ACTIONS).map(([k, v]) => [k, v.event])),
  auditAction: 'hog_review.bulk',
  executeRow: async (action, requestId, comment, actor) => {
    const spec = HOG_ACTIONS[action]!; // action already validated ∈ allowedActions
    await transition({
      requestId,
      event: spec.event,
      actor: { id: actor.id, roles: actor.roles },
      effects: async (tx) => {
        await tx.approval.create({
          data: {
            requestId,
            stage: ApprovalStage.HOG_FINAL,
            decision: spec.decision,
            reviewerId: actor.id,
            comments: comment || null,
            decidedAt: new Date(),
          },
        });
      },
    });
  },
};

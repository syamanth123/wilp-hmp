import { prisma, ApprovalStage, ApprovalDecision, HandoutStatus, RoleName } from '@hmp/db';
import { transition } from '@hmp/workflow';
import type { BulkReviewRoleConfig } from '@/lib/bulk-review';
import { rejectAllocationEffect } from '@/lib/pc-allocation-review';

// Plain (non-'use server') config module so both the server action and the
// integration test can import it. Mirrors pc/bulk-review/config.ts, but for the
// ALLOCATION review gate (status ALLOCATED) rather than content review.

const ALLOCATION_EVENTS = {
  pc_confirm_allocation: 'ASSIGNED',
  pc_reject_allocation: 'ALLOCATION_REJECTED',
} as const;

export const PC_ALLOCATION_CONFIG: BulkReviewRoleConfig = {
  // v1.4.1: only the PC the HOG named may confirm or send back (none named: any PC of the department).
  authorityCheck: async (requestId, actor) => {
    const pc = await prisma.requestAssignee.findFirst({
      where: { requestId, role: RoleName.PROGRAMME_COMMITTEE, endedAt: null },
      select: { userId: true },
    });
    return pc && pc.userId !== actor.id ? 'not_your_allocation' : null;
  },
  queueStatus: HandoutStatus.ALLOCATED,
  allowedActions: ['pc_confirm_allocation', 'pc_reject_allocation'],
  commentRequiredFor: ['pc_reject_allocation'],
  eventMap: ALLOCATION_EVENTS,
  auditAction: 'pc_allocation_review.bulk',
  executeRow: async (action, requestId, comment, actor) => {
    if (action === 'pc_reject_allocation') {
      await transition({
        requestId,
        event: 'ALLOCATION_REJECTED',
        actor: { id: actor.id, roles: actor.roles },
        meta: { reason: comment },
        effects: rejectAllocationEffect(comment, actor.id),
      });
      return;
    }
    // pc_confirm_allocation → ASSIGNED (mirrors confirmAssignmentAction).
    await transition({
      requestId,
      event: 'ASSIGNED',
      actor: { id: actor.id, roles: actor.roles },
      effects: async (tx) => {
        await tx.approval.create({
          data: {
            requestId,
            stage: ApprovalStage.PC_REVIEW,
            decision: ApprovalDecision.APPROVED,
            reviewerId: actor.id,
            comments: comment || null,
            decidedAt: new Date(),
          },
        });
      },
    });
  },
};

import { prisma, HandoutStatus } from '@hmp/db';
import type { BulkReviewRoleConfig } from '@/lib/bulk-review';
import { smeApprove, smeRevert } from '@/app/sme/review/[id]/sme-review';

const SME_EVENTS = { sme_approve: 'SME_APPROVED', sme_revert: 'SME_REVERTED' } as const;

export const SME_CONFIG: BulkReviewRoleConfig = {
  queueStatus: HandoutStatus.SME_REVIEW,
  allowedActions: ['sme_approve', 'sme_revert'],
  commentRequiredFor: ['sme_revert'],
  eventMap: SME_EVENTS,
  auditAction: 'sme_review.bulk',
  // Per-request authority: only the assigned SME may act. Mirrors the
  // assertAssignedSme gate inside the smeApprove/smeRevert helpers (which
  // re-check it as defense-in-depth at execution time).
  authorityCheck: async (requestId, actor) => {
    const a = await prisma.smeAssignment.findUnique({
      where: { requestId },
      select: { smeUserId: true },
    });
    return a?.smeUserId === actor.id ? null : 'not_your_sme_assignment';
  },
  // Reuse the single-action helpers verbatim — smeRevert writes BOTH the
  // Approval(SME_REVIEW, REWORK) AND a Comment-thread row (the faculty banner
  // feed); smeApprove takes no comment.
  executeRow: async (action, requestId, comment, actor) => {
    const sme = { id: actor.id, roles: actor.roles };
    if (action === 'sme_approve') await smeApprove(requestId, sme);
    else await smeRevert(requestId, sme, comment);
  },
};

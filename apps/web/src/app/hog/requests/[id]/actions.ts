'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  prisma,
  RoleName,
  ApprovalStage,
  ApprovalDecision,
  HandoutStatus,
} from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import {
  transition,
  WorkflowError,
  assertOffCampusCap,
} from '@hmp/workflow';
import { notifyTransition } from '@/lib/notifications';
import { audit } from '@/lib/audit';
import { clearTodayRecommendations, recommendFaculty } from '@hmp/ai';

const allocateSchema = z.object({
  requestId: z.string().cuid(),
  facultyIds: z.array(z.string().cuid()).min(1, 'Pick at least one faculty'),
});

const approvalSchema = z.object({
  requestId: z.string().cuid(),
  comments: z.string().max(2000).optional().default(''),
});

const reworkSchema = approvalSchema.extend({
  comments: z.string().min(3, 'Rework requires a comment'),
});

function revalidate(requestId: string) {
  revalidatePath(`/hog/requests/${requestId}`);
  revalidatePath('/hog/requests');
  revalidatePath('/hog');
  revalidatePath(`/ic/requests/${requestId}`);
  revalidatePath(`/pc/requests/${requestId}`);
}

export async function allocateFacultyAction(formData: FormData) {
  const actor = requireRole(await getSessionUser(), RoleName.HOG);
  const facultyIds = formData.getAll('facultyIds').map(String).filter(Boolean);
  const parsed = allocateSchema.safeParse({
    requestId: formData.get('requestId'),
    facultyIds,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  const request = await prisma.handoutRequest.findUnique({
    where: { id: parsed.data.requestId },
    include: { offering: true },
  });
  if (!request) return { error: 'Request not found' };
  if (request.status !== HandoutStatus.REQUESTED) {
    return { error: `Cannot allocate from status ${request.status}` };
  }

  const cap = (await prisma.workflowConfig.findUnique({ where: { key: 'default' } }))?.offCampusMaxCourses ?? 3;

  const faculties = await prisma.user.findMany({
    where: { id: { in: parsed.data.facultyIds }, active: true },
    select: { id: true, facultyType: true, name: true },
  });
  if (faculties.length !== parsed.data.facultyIds.length) {
    return { error: 'One or more selected faculty are inactive or unknown' };
  }

  try {
    await transition({
      requestId: request.id,
      event: 'FACULTY_ALLOCATED',
      actor: { id: actor.id, roles: actor.roles },
      meta: { facultyIds: parsed.data.facultyIds },
      effects: async (tx) => {
        // Per-faculty off-campus / adjunct cap check, inside the txn so
        // concurrent allocations cannot both squeak past the limit.
        for (const f of faculties) {
          const load = await tx.facultyAssignment.count({
            where: {
              facultyId: f.id,
              active: true,
              request: { offering: { semesterId: request.offering.semesterId } },
            },
          });
          try {
            assertOffCampusCap({ facultyType: f.facultyType, activeAssignmentsInSemester: load }, cap);
          } catch (err) {
            if (err instanceof WorkflowError) {
              throw new WorkflowError(err.code, `${f.name}: ${err.message}`);
            }
            throw err;
          }

          await tx.facultyAssignment.create({
            data: {
              requestId: request.id,
              facultyId: f.id,
              facultyType: f.facultyType ?? 'ON_CAMPUS',
            },
          });
        }
        await tx.approval.create({
          data: {
            requestId: request.id,
            stage: ApprovalStage.HOG_REVIEW,
            decision: ApprovalDecision.APPROVED,
            reviewerId: actor.id,
            decidedAt: new Date(),
          },
        });
      },
    });
  } catch (err) {
    if (err instanceof WorkflowError) return { error: err.message };
    throw err;
  }

  await notifyTransition({
    requestId: request.id,
    event: 'FACULTY_ALLOCATED',
    actor: { id: actor.id, name: actor.name },
  });

  revalidate(request.id);
  return { ok: true };
}

export async function finalApproveAction(formData: FormData) {
  const actor = requireRole(await getSessionUser(), RoleName.HOG);
  const parsed = approvalSchema.safeParse({
    requestId: formData.get('requestId'),
    comments: formData.get('comments') ?? '',
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  try {
    await transition({
      requestId: parsed.data.requestId,
      event: 'FINAL_APPROVED',
      actor: { id: actor.id, roles: actor.roles },
      effects: async (tx) => {
        await tx.approval.create({
          data: {
            requestId: parsed.data.requestId,
            stage: ApprovalStage.HOG_FINAL,
            decision: ApprovalDecision.APPROVED,
            reviewerId: actor.id,
            comments: parsed.data.comments || null,
            decidedAt: new Date(),
          },
        });
      },
    });
  } catch (err) {
    if (err instanceof WorkflowError) return { error: err.message };
    throw err;
  }

  await notifyTransition({
    requestId: parsed.data.requestId,
    event: 'FINAL_APPROVED',
    actor: { id: actor.id, name: actor.name },
  });

  revalidate(parsed.data.requestId);
  return { ok: true };
}

export async function finalRejectAction(formData: FormData) {
  const actor = requireRole(await getSessionUser(), RoleName.HOG);
  const parsed = reworkSchema.safeParse({
    requestId: formData.get('requestId'),
    comments: formData.get('comments') ?? '',
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Reject requires a reason' };

  try {
    await transition({
      requestId: parsed.data.requestId,
      event: 'FINAL_REJECTED',
      actor: { id: actor.id, roles: actor.roles },
      effects: async (tx) => {
        await tx.approval.create({
          data: {
            requestId: parsed.data.requestId,
            stage: ApprovalStage.HOG_FINAL,
            decision: ApprovalDecision.REJECTED,
            reviewerId: actor.id,
            comments: parsed.data.comments,
            decidedAt: new Date(),
          },
        });
      },
    });
  } catch (err) {
    if (err instanceof WorkflowError) return { error: err.message };
    throw err;
  }

  await notifyTransition({
    requestId: parsed.data.requestId,
    event: 'FINAL_REJECTED',
    actor: { id: actor.id, name: actor.name },
  });

  revalidate(parsed.data.requestId);
  return { ok: true };
}

export async function regenerateRecommendationAction(formData: FormData) {
  const actor = requireRole(await getSessionUser(), RoleName.HOG);
  const requestId = String(formData.get('requestId') ?? '');
  if (!requestId) return { error: 'Missing requestId' };
  let count = 0;
  try {
    await clearTodayRecommendations(requestId);
    const res = await recommendFaculty({ requestId, forceRefresh: true });
    count = res.candidates?.length ?? 0;
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Recommendation failed' };
  }
  await audit({
    actorId: actor.id,
    action: 'ai.recommend.regenerate',
    entity: 'HandoutRequest',
    entityId: requestId,
    after: { count },
    requestId,
  });
  revalidatePath(`/hog/requests/${requestId}`);
  return { ok: true, actor: actor.id };
}

export async function hogRequestReworkAction(formData: FormData) {
  const actor = requireRole(await getSessionUser(), RoleName.HOG);
  const parsed = reworkSchema.safeParse({
    requestId: formData.get('requestId'),
    comments: formData.get('comments') ?? '',
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Rework requires a comment' };

  try {
    await transition({
      requestId: parsed.data.requestId,
      event: 'REVIEW_REWORK',
      actor: { id: actor.id, roles: actor.roles },
      effects: async (tx) => {
        await tx.approval.create({
          data: {
            requestId: parsed.data.requestId,
            stage: ApprovalStage.HOG_FINAL,
            decision: ApprovalDecision.REWORK,
            reviewerId: actor.id,
            comments: parsed.data.comments,
            decidedAt: new Date(),
          },
        });
      },
    });
  } catch (err) {
    if (err instanceof WorkflowError) return { error: err.message };
    throw err;
  }

  await notifyTransition({
    requestId: parsed.data.requestId,
    event: 'REVIEW_REWORK',
    actor: { id: actor.id, name: actor.name },
  });

  revalidate(parsed.data.requestId);
  return { ok: true };
}

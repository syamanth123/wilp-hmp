'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma, RoleName, ApprovalStage, ApprovalDecision, HandoutStatus } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { transition, WorkflowError } from '@hmp/workflow';
// Prompt 9a: the real two-mode `publishToLms` ships in @hmp/integrations but is
// not wired here yet — that's Prompt 9b. Until then publishAction keeps using
// the preserved stub so behavior is unchanged (no Taxila API / MinIO needed).
import { publishToLmsStub } from '@hmp/integrations';
import { notifyTransition } from '@/lib/notifications';

const schema = z.object({
  requestId: z.string().cuid(),
});

function revalidate(requestId: string) {
  revalidatePath(`/ic/requests/${requestId}`);
  revalidatePath('/ic/requests');
  revalidatePath('/ic');
  revalidatePath(`/hog/requests/${requestId}`);
  revalidatePath(`/pc/requests/${requestId}`);
  revalidatePath(`/faculty/assignments/${requestId}`);
}

export async function publishAction(formData: FormData) {
  const actor = requireRole(await getSessionUser(), RoleName.INSTRUCTION_CELL);
  const parsed = schema.safeParse({ requestId: formData.get('requestId') });
  if (!parsed.success) return { error: 'Invalid input' };

  const request = await prisma.handoutRequest.findUnique({
    where: { id: parsed.data.requestId },
    include: {
      offering: {
        include: { course: true, semester: { include: { programme: true } } },
      },
      handout: { include: { currentVersion: true } },
    },
  });
  if (!request) return { error: 'Request not found' };
  if (request.status !== HandoutStatus.APPROVED) {
    return { error: `Cannot publish from status ${request.status}` };
  }
  if (!request.handout?.currentVersion) {
    return { error: 'No current version to publish' };
  }

  const lmsResult = await publishToLmsStub({
    handoutId: request.handout.id,
    versionNo: request.handout.currentVersion.versionNo,
    contentHtml: request.handout.currentVersion.contentHtml,
    courseCode: request.offering.course.code,
    courseTitle: request.offering.course.title,
    programmeCode: request.offering.semester.programme.code,
    semesterName: request.offering.semester.name,
  });

  if (lmsResult.status === 'failed') {
    // Persist the failed attempt without advancing status.
    await prisma.lmsPublishLog.create({
      data: {
        handoutId: request.handout.id,
        status: 'failed',
        responseJson: lmsResult.responseJson as never,
      },
    });
    revalidate(parsed.data.requestId);
    return { error: 'LMS publish failed. See publish log.' };
  }

  try {
    await transition({
      requestId: parsed.data.requestId,
      event: 'PUBLISHED',
      actor: { id: actor.id, roles: actor.roles },
      effects: async (tx, ctx) => {
        await tx.lmsPublishLog.create({
          data: {
            handoutId: ctx.handoutId,
            status: 'success',
            responseJson: lmsResult.responseJson as never,
          },
        });
        await tx.approval.create({
          data: {
            requestId: parsed.data.requestId,
            stage: ApprovalStage.IC_PUBLISH,
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
    requestId: parsed.data.requestId,
    event: 'PUBLISHED',
    actor: { id: actor.id, name: actor.name },
  });

  revalidate(parsed.data.requestId);
  return { ok: true };
}

export async function archiveAction(formData: FormData) {
  const actor = requireRole(await getSessionUser(), RoleName.INSTRUCTION_CELL);
  const parsed = schema.safeParse({ requestId: formData.get('requestId') });
  if (!parsed.success) return { error: 'Invalid input' };

  const request = await prisma.handoutRequest.findUnique({
    where: { id: parsed.data.requestId },
    select: { status: true },
  });
  if (!request) return { error: 'Request not found' };
  if (request.status !== HandoutStatus.PUBLISHED) {
    return { error: `Cannot archive from status ${request.status}` };
  }

  try {
    await transition({
      requestId: parsed.data.requestId,
      event: 'ARCHIVED',
      actor: { id: actor.id, roles: actor.roles },
    });
  } catch (err) {
    if (err instanceof WorkflowError) return { error: err.message };
    throw err;
  }

  await notifyTransition({
    requestId: parsed.data.requestId,
    event: 'ARCHIVED',
    actor: { id: actor.id, name: actor.name },
  });

  revalidate(parsed.data.requestId);
  return { ok: true };
}

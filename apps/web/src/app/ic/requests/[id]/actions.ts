'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  prisma,
  RoleName,
  ApprovalStage,
  ApprovalDecision,
  HandoutStatus,
  LmsPublishMode,
} from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { transition, WorkflowError } from '@hmp/workflow';
import { publishToLms, TaxilaPublishError, type PublishInput } from '@hmp/integrations';
import { audit } from '@/lib/audit';
import {
  notifyTransition,
  notifyPublishExportReady,
  notifyManuallyPublished,
} from '@/lib/notifications';

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

  const handoutId = request.handout.id;
  const publishInput: PublishInput = {
    handoutId,
    refNo: request.refNo,
    versionNo: request.handout.currentVersion.versionNo,
    contentHtml: request.handout.currentVersion.contentHtml,
    contentJson: request.handout.currentVersion.contentJson,
    // 11c: pass structured BITS data through so the Mode B export ZIP renders
    // it via the BITS renderer when present. Null/undefined for legacy rows;
    // Mode B falls back to contentHtml automatically (resolveHandoutHtml).
    data: request.handout.currentVersion.data,
    courseCode: request.offering.course.code,
    courseTitle: request.offering.course.title,
    programmeCode: request.offering.semester.programme.code,
    semesterName: request.offering.semester.name,
    publishedBy: actor.id,
  };

  let result;
  try {
    result = await publishToLms(publishInput);
  } catch (err) {
    if (err instanceof TaxilaPublishError) {
      // Persist the failed attempt without advancing the workflow.
      await prisma.lmsPublishLog.create({
        data: {
          handoutId,
          status: 'failed',
          mode: err.mode === 'http' ? LmsPublishMode.HTTP : LmsPublishMode.EXPORT,
          responseJson: { error: err.message, detail: err.detail } as never,
        },
      });
      revalidate(parsed.data.requestId);
      return { error: `Publish failed: ${err.message}` };
    }
    throw err;
  }

  // Mode B — export ZIP generated. The request stays APPROVED; the IC must
  // confirm a manual upload via confirmManualPublishAction.
  if (result.mode === 'export') {
    await prisma.lmsPublishLog.create({
      data: {
        handoutId,
        status: 'EXPORTED',
        mode: LmsPublishMode.EXPORT,
        externalRef: result.externalRef,
        s3Key: result.s3Key,
      },
    });
    await audit({
      actorId: actor.id,
      action: 'handout.exported',
      entity: 'Handout',
      entityId: handoutId,
      requestId: parsed.data.requestId,
      after: { mode: 'EXPORT', s3Key: result.s3Key },
    });
    await notifyPublishExportReady({
      requestId: parsed.data.requestId,
      actor: { id: actor.id, name: actor.name },
    });
    revalidate(parsed.data.requestId);
    return { ok: true, mode: 'export' as const };
  }

  // Mode A — Taxila HTTP publish succeeded; advance the workflow to PUBLISHED.
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
            mode: LmsPublishMode.HTTP,
            externalRef: result.externalRef,
            responseJson: { request: result.request, response: result.response } as never,
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
  return { ok: true, mode: 'http' as const };
}

/**
 * Mode B step 2: the IC confirms they manually uploaded the export ZIP to
 * Taxila, advancing the request APPROVED → PUBLISHED. Separate from the export
 * step on purpose — the system never claims a handout is published until a
 * human confirms the upload happened.
 */
export async function confirmManualPublishAction(formData: FormData) {
  const actor = requireRole(await getSessionUser(), RoleName.INSTRUCTION_CELL);
  const parsed = schema.safeParse({ requestId: formData.get('requestId') });
  if (!parsed.success) return { error: 'Invalid input' };

  const request = await prisma.handoutRequest.findUnique({
    where: { id: parsed.data.requestId },
    include: { handout: { select: { id: true } } },
  });
  if (!request) return { error: 'Request not found' };
  if (!request.handout) return { error: 'No handout to publish' };
  if (request.status !== HandoutStatus.APPROVED) {
    return { error: `Cannot confirm publication from status ${request.status}` };
  }

  const handoutId = request.handout.id;
  const exportLog = await prisma.lmsPublishLog.findFirst({
    where: { handoutId, mode: LmsPublishMode.EXPORT, status: 'EXPORTED' },
    orderBy: { publishedAt: 'desc' },
    select: { s3Key: true },
  });
  if (!exportLog) {
    return { error: 'No export package exists for this request. Publish (export) it first.' };
  }
  const alreadyConfirmed = await prisma.lmsPublishLog.findFirst({
    where: { handoutId, status: 'MANUALLY_CONFIRMED' },
    select: { id: true },
  });
  if (alreadyConfirmed) {
    return { error: 'This request was already marked as manually published.' };
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
            status: 'MANUALLY_CONFIRMED',
            mode: LmsPublishMode.MANUALLY_CONFIRMED,
            // Point at the source export's durable s3Key so an auditor can
            // chain this confirmation back to the exact package that was
            // uploaded (not a stale presigned URL).
            externalRef: exportLog.s3Key,
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

  await audit({
    actorId: actor.id,
    action: 'handout.manually_confirmed',
    entity: 'Handout',
    entityId: handoutId,
    requestId: parsed.data.requestId,
    after: { sourceExportS3Key: exportLog.s3Key },
  });
  await notifyManuallyPublished({
    requestId: parsed.data.requestId,
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

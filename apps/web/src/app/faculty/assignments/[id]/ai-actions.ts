'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma, RoleName, HandoutStatus, type Prisma } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { generateHandoutDraft, AiUnconfiguredError } from '@hmp/ai';
import { appendVersion, renderTiptapToHtml } from '@/lib/handout-versioning';
import { audit } from '@/lib/audit';

const generateSchema = z.object({
  requestId: z.string().cuid(),
  forceRefresh: z.boolean().optional().default(false),
});

const applySchema = z.object({
  requestId: z.string().cuid(),
  draftId: z.string().cuid(),
});

const EDITABLE_STATUSES: HandoutStatus[] = [
  HandoutStatus.IN_PROGRESS,
  HandoutStatus.REWORK_REQUESTED,
];

function revalidate(requestId: string) {
  revalidatePath(`/faculty/assignments/${requestId}`);
}

async function loadMyAssignment(requestId: string, facultyId: string) {
  const request = await prisma.handoutRequest.findUnique({
    where: { id: requestId },
    include: {
      handout: true,
      assignments: { where: { facultyId, active: true }, take: 1 },
    },
  });
  if (!request) return null;
  if (request.assignments.length === 0) return null;
  return request;
}

export async function generateAiDraftAction(formData: FormData) {
  const me = requireRole(await getSessionUser(), RoleName.FACULTY);
  const parsed = generateSchema.safeParse({
    requestId: formData.get('requestId'),
    forceRefresh: formData.get('forceRefresh') === 'true',
  });
  if (!parsed.success) return { error: 'Invalid input' };

  const request = await loadMyAssignment(parsed.data.requestId, me.id);
  if (!request) return { error: 'Assignment not found' };
  if (!request.handout) return { error: 'Editing has not started yet' };
  if (!EDITABLE_STATUSES.includes(request.status)) {
    return { error: `Cannot generate from status ${request.status}` };
  }

  try {
    const result = await generateHandoutDraft({
      handoutId: request.handout.id,
      forceRefresh: parsed.data.forceRefresh,
    });
    await audit({
      actorId: me.id,
      action: 'ai.draft.generated',
      entity: 'AIDraftLog',
      entityId: result.draftId,
      requestId: request.id,
      after: { model: result.model, source: result.source },
    });
    return {
      ok: true,
      draftId: result.draftId,
      tiptapJson: result.tiptapJson,
      previewHtml: renderTiptapToHtml(result.tiptapJson),
      source: result.source,
      model: result.model,
    };
  } catch (err) {
    if (err instanceof AiUnconfiguredError) {
      return { error: 'AI provider not configured. Ask admin to set AI_PROVIDER + API key.' };
    }
    return { error: err instanceof Error ? err.message : 'Draft generation failed' };
  }
}

export async function applyAiDraftAction(formData: FormData) {
  const me = requireRole(await getSessionUser(), RoleName.FACULTY);
  const parsed = applySchema.safeParse({
    requestId: formData.get('requestId'),
    draftId: formData.get('draftId'),
  });
  if (!parsed.success) return { error: 'Invalid input' };

  const request = await loadMyAssignment(parsed.data.requestId, me.id);
  if (!request) return { error: 'Assignment not found' };
  if (!request.handout) return { error: 'Editing has not started yet' };
  if (!EDITABLE_STATUSES.includes(request.status)) {
    return { error: `Cannot apply draft from status ${request.status}` };
  }

  const draft = await prisma.aIDraftLog.findUnique({
    where: { id: parsed.data.draftId },
  });
  if (!draft || draft.handoutId !== request.handout.id) {
    return { error: 'Draft not found' };
  }
  const payload = draft.payload as { tiptapJson?: unknown } | null;
  if (!payload?.tiptapJson) return { error: 'Draft payload is empty' };

  const handoutId = request.handout.id;
  const version = await prisma.$transaction(async (tx) => {
    return appendVersion(
      tx,
      handoutId,
      me.id,
      payload.tiptapJson as Prisma.InputJsonValue,
      `AI-generated draft (${draft.source} · ${draft.model})`,
    );
  });
  await audit({
    actorId: me.id,
    action: 'ai.draft.applied',
    entity: 'HandoutVersion',
    entityId: version.id,
    requestId: request.id,
    after: { versionNo: version.versionNo, draftId: draft.id, source: draft.source },
  });

  revalidate(request.id);
  return { ok: true, versionNo: version.versionNo };
}

'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { prisma, RoleName, HandoutStatus, type Prisma } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { transition, WorkflowError, movedOnMessage } from '@hmp/workflow';
import { appendVersion, createInitialStructuredVersion } from '@/lib/handout-versioning';
import {
  loadAndResolveAutoFetchSource,
  type RequestLite,
  type ResolvedSource,
} from '@/lib/handout-auto-fetch';
import { audit } from '@/lib/audit';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { notifyTransition } from '@/lib/notifications';
import { runQualityReport, AiUnconfiguredError } from '@hmp/ai';
import { enqueueAiJob } from '@hmp/queue';
import { AI_OFF_MESSAGE, aiFeaturesEnabled } from '@/lib/features';
import { GENERIC_ERROR, formError } from '@/lib/form-error';

const tiptapDocSchema = z.object({
  type: z.literal('doc'),
  content: z.array(z.any()).optional(),
});

const saveSchema = z.object({
  requestId: z.string().cuid(),
  contentJson: tiptapDocSchema,
  notes: z.string().max(1000).optional().default(''),
});

const submitSchema = saveSchema.extend({
  notes: z.string().max(1000).optional().default('Submitted for review.'),
});

const idOnlySchema = z.object({ requestId: z.string().cuid() });

function revalidate(requestId: string) {
  revalidatePath(`/faculty/assignments/${requestId}`);
  revalidatePath('/faculty/assignments');
  revalidatePath('/faculty');
  revalidatePath(`/pc/requests/${requestId}`);
  revalidatePath(`/hog/requests/${requestId}`);
  revalidatePath(`/ic/requests/${requestId}`);
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

export async function acceptAssignmentAction(formData: FormData) {
  const me = requireRole(await getSessionUser(), RoleName.FACULTY);
  const parsed = idOnlySchema.safeParse({ requestId: formData.get('requestId') });
  if (!parsed.success) return { error: GENERIC_ERROR };

  const request = await loadMyAssignment(parsed.data.requestId, me.id);
  if (!request)
    return { error: "You're no longer assigned to this handout. Go back to My assignments." };
  if (request.status !== HandoutStatus.ASSIGNED) {
    return { error: movedOnMessage(request.status) };
  }

  const assignment = request.assignments[0]!;
  if (assignment.acceptedAt) return { ok: true };

  await prisma.facultyAssignment.update({
    where: { id: assignment.id },
    data: { acceptedAt: new Date() },
  });
  await audit({
    actorId: me.id,
    action: 'assignment.accepted',
    entity: 'FacultyAssignment',
    entityId: assignment.id,
    requestId: request.id,
  });

  revalidate(request.id);
  return { ok: true };
}

export async function startEditingAction(formData: FormData) {
  const me = requireRole(await getSessionUser(), RoleName.FACULTY);
  const parsed = idOnlySchema.safeParse({ requestId: formData.get('requestId') });
  if (!parsed.success) return { error: GENERIC_ERROR };

  const request = await loadMyAssignment(parsed.data.requestId, me.id);
  if (!request)
    return { error: "You're no longer assigned to this handout. Go back to My assignments." };
  if (!request.assignments[0]!.acceptedAt) {
    return { error: 'Click Accept assignment first.' };
  }

  // Auto-fetch context (Prompt 11e): re-load with the joins the cascade
  // resolver needs (course identity + semester name). loadMyAssignment is
  // shared with other actions and stays narrow; this widening is local.
  const fullRequest = await prisma.handoutRequest.findUnique({
    where: { id: request.id },
    include: {
      offering: {
        include: {
          course: true,
          semester: true,
        },
      },
    },
  });
  if (!fullRequest)
    return { error: "You're no longer assigned to this handout. Go back to My assignments." };

  const cascadeContext: RequestLite = {
    id: fullRequest.id,
    course: {
      id: fullRequest.offering.course.id,
      bitsCourseNumber: fullRequest.offering.course.bitsCourseNumber,
      alternateCodes: fullRequest.offering.course.alternateCodes,
      title: fullRequest.offering.course.title,
    },
    semesterName: fullRequest.offering.semester.name,
    facultyName: me.name,
  };

  let resolved: ResolvedSource | null = null;
  try {
    await transition({
      requestId: request.id,
      event: 'EDIT_STARTED',
      actor: { id: me.id, roles: me.roles },
      effects: async (tx, ctx) => {
        resolved = await loadAndResolveAutoFetchSource(tx, cascadeContext);
        const sourceLabel =
          resolved.tier === 'empty'
            ? 'First version, started from a blank handout.'
            : `First version, started from ${resolved.sourceDetail.charAt(0).toLowerCase()}${resolved.sourceDetail.slice(1)}.`;
        await createInitialStructuredVersion(tx, ctx.handoutId, me.id, resolved.data, sourceLabel);
      },
    });
  } catch (err) {
    if (err instanceof WorkflowError) return { error: err.message };
    throw err;
  }

  // EDIT_STARTED intentionally not fanned out — faculty acting on own work.

  await audit({
    actorId: me.id,
    action: 'handout.editing.started',
    entity: 'HandoutRequest',
    entityId: request.id,
    requestId: request.id,
    after: { autoFetchTier: resolved!.tier },
  });

  revalidate(request.id);

  // Redirect with search params so the AutoFetchBanner appears on the next
  // page render. The banner clears when faculty dismisses it (router.replace
  // to the no-params URL) or navigates away. Persisting the source detail
  // elsewhere is intentionally avoided — banner-shows-once is the UX.
  const detail = encodeURIComponent(resolved!.sourceDetail);
  redirect(`/faculty/assignments/${request.id}?autoFetched=${resolved!.tier}&detail=${detail}`);
}

const EDITABLE_STATUSES: HandoutStatus[] = [
  HandoutStatus.IN_PROGRESS,
  HandoutStatus.REWORK_REQUESTED,
];

export async function saveDraftAction(formData: FormData) {
  const me = requireRole(await getSessionUser(), RoleName.FACULTY);
  let contentJson: unknown;
  try {
    contentJson = JSON.parse(String(formData.get('contentJson') ?? ''));
  } catch {
    return { error: GENERIC_ERROR };
  }
  const parsed = saveSchema.safeParse({
    requestId: formData.get('requestId'),
    contentJson,
    notes: formData.get('notes') ?? '',
  });
  if (!parsed.success) return { error: formError(parsed.error) };

  const request = await loadMyAssignment(parsed.data.requestId, me.id);
  if (!request)
    return { error: "You're no longer assigned to this handout. Go back to My assignments." };
  if (!request.handout) return { error: 'Click Start editing first.' };
  if (!EDITABLE_STATUSES.includes(request.status)) {
    return { error: movedOnMessage(request.status) };
  }

  const handoutId = request.handout.id;
  const version = await prisma.$transaction(async (tx) => {
    return appendVersion(
      tx,
      handoutId,
      me.id,
      parsed.data.contentJson as Prisma.InputJsonValue,
      parsed.data.notes || null,
    );
  });
  await audit({
    actorId: me.id,
    action: 'handout.version.saved',
    entity: 'HandoutVersion',
    entityId: version.id,
    requestId: request.id,
    after: { versionNo: version.versionNo },
  });

  revalidate(request.id);
  return { ok: true, versionNo: version.versionNo, savedAt: version.createdAt.toISOString() };
}

export async function submitForReviewAction(formData: FormData) {
  const me = requireRole(await getSessionUser(), RoleName.FACULTY);
  let contentJson: unknown;
  try {
    contentJson = JSON.parse(String(formData.get('contentJson') ?? ''));
  } catch {
    return { error: GENERIC_ERROR };
  }
  const parsed = submitSchema.safeParse({
    requestId: formData.get('requestId'),
    contentJson,
    notes: formData.get('notes') ?? '',
  });
  if (!parsed.success) return { error: formError(parsed.error) };

  const request = await loadMyAssignment(parsed.data.requestId, me.id);
  if (!request)
    return { error: "You're no longer assigned to this handout. Go back to My assignments." };
  if (!request.handout) return { error: 'Click Start editing first.' };
  if (!EDITABLE_STATUSES.includes(request.status)) {
    return { error: movedOnMessage(request.status) };
  }

  // Prompt 12-b: SME review is mandatory (same as submitStructuredForReviewAction).
  // Every submit routes through the SME approval gate; a missing SmeAssignment
  // blocks submission rather than silently skipping the gate.
  const smeAssignment = await prisma.smeAssignment.findUnique({
    where: { requestId: request.id },
    select: { id: true },
  });
  if (!smeAssignment) {
    return {
      error:
        'No Subject Matter Expert is assigned to this handout. Ask the Head of Group to assign one before submitting.',
    };
  }
  const submitEvent = 'SME_REVIEW_REQUESTED' as const;

  try {
    await transition({
      requestId: request.id,
      event: submitEvent,
      actor: { id: me.id, roles: me.roles },
      effects: async (tx, ctx) => {
        await appendVersion(
          tx,
          ctx.handoutId,
          me.id,
          parsed.data.contentJson as Prisma.InputJsonValue,
          parsed.data.notes || 'Submitted for review.',
        );
      },
    });
  } catch (err) {
    if (err instanceof WorkflowError) return { error: err.message };
    throw err;
  }

  await notifyTransition({
    requestId: request.id,
    event: submitEvent,
    actor: { id: me.id, name: me.name },
  });

  // AI quality check on the freshly-submitted version — a fire-and-forget
  // side-effect (the faculty has submitted and moved on; the report just needs
  // to exist by the time a reviewer opens the page). When WORKERS_ENABLED, it's
  // queued so the submit returns without waiting on the LLM; otherwise it runs
  // inline (and inline is also the fallback if enqueue throws). The manual
  // "Run quality check" button (runQualityCheckAction) stays SYNCHRONOUS — the
  // faculty awaits that result, so it's not queued. See audit §1 (queueing is
  // a property of the calling context).
  // Quality report on submit only with AI switched on (AI_FEATURES_ENABLED).
  if (aiFeaturesEnabled()) {
    try {
      const handoutAfter = await prisma.handout.findUnique({
        where: { id: request.handout.id },
        select: { currentVersionId: true },
      });
      if (handoutAfter?.currentVersionId) {
        const versionId = handoutAfter.currentVersionId;
        let queued = false;
        if (process.env.WORKERS_ENABLED === 'true') {
          try {
            await enqueueAiJob({
              kind: 'quality_report',
              handoutVersionId: versionId,
              requestId: request.id,
            });
            queued = true;
          } catch (err) {
            console.error('quality_check_enqueue_failed — running inline', err);
          }
        }
        if (!queued) {
          await runQualityReport(
            { handoutVersionId: versionId, bypassRateLimit: true },
            { actorId: me.id },
          );
        }
      }
    } catch (err) {
      if (!(err instanceof AiUnconfiguredError)) {
        console.error('quality_check_on_submit_failed', err);
      }
    }
  }

  revalidate(request.id);
  return { ok: true };
}

export async function runQualityCheckAction(formData: FormData) {
  const me = requireRole(await getSessionUser(), RoleName.FACULTY);
  if (!aiFeaturesEnabled()) return { error: AI_OFF_MESSAGE };
  // Per-user AI throttle (Prompt 20). RPC-shaped { error }, fail-open.
  const rl = await rateLimit(`ai:${me.id}`, RATE_LIMITS.ai.limit, RATE_LIMITS.ai.windowSec);
  if (!rl.ok) return { error: 'Rate limit reached — try again in a little while.' };
  const parsed = idOnlySchema.safeParse({ requestId: formData.get('requestId') });
  if (!parsed.success) return { error: GENERIC_ERROR };
  const request = await loadMyAssignment(parsed.data.requestId, me.id);
  if (!request)
    return { error: "You're no longer assigned to this handout. Go back to My assignments." };
  if (!request.handout) return { error: 'Click Start editing first.' };

  const handout = await prisma.handout.findUnique({
    where: { id: request.handout.id },
    select: { currentVersionId: true },
  });
  if (!handout?.currentVersionId)
    return { error: 'Save your handout before running the quality check.' };

  try {
    const report = await runQualityReport(
      { handoutVersionId: handout.currentVersionId },
      { actorId: me.id },
    );
    await audit({
      actorId: me.id,
      action: 'ai.quality.generated',
      entity: 'AIQualityReport',
      entityId: report.reportId,
      requestId: request.id,
      after: { score: report.score, model: report.model, cached: report.cached },
    });
    revalidate(request.id);
    return { ok: true, score: report.score, cached: report.cached };
  } catch (err) {
    if (err instanceof AiUnconfiguredError) {
      return { error: "AI features aren't available right now." };
    }
    console.error('quality_check_failed', err);
    return {
      error:
        err instanceof Error && /handout_empty|version_not_found/.test(err.message)
          ? 'Save your handout before running the quality check.'
          : "The quality check couldn't run. Try again.",
    };
  }
}

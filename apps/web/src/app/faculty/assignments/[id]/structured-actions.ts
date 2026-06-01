'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma, RoleName, HandoutStatus, BitsHandoutSchemaV1, type BitsHandoutV1 } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { transition, WorkflowError } from '@hmp/workflow';
import { appendStructuredVersion } from '@/lib/handout-versioning';
import { audit } from '@/lib/audit';
import { notifyTransition } from '@/lib/notifications';
import { runQualityReport, AiUnconfiguredError, generateStructuredHandoutDraft } from '@hmp/ai';
import { enqueueAiJob } from '@hmp/queue';
import { blankHandoutForRequest } from './structured-editor/state';

/**
 * Server actions for the Prompt 11d structured editor. Mirrors the shape of
 * `actions.ts`'s `saveDraftAction` / `submitForReviewAction` but the input is
 * `data` (BitsHandoutV1 JSON) instead of `contentJson` (TipTap JSON), and
 * persistence goes through `appendStructuredVersion`.
 *
 * The legacy actions in `actions.ts` are untouched — they continue serving
 * the freeform TipTap editor for pre-Prompt-11d handouts.
 */

const EDITABLE_STATUSES: HandoutStatus[] = [
  HandoutStatus.IN_PROGRESS,
  HandoutStatus.REWORK_REQUESTED,
];

const idOnlySchema = z.object({ requestId: z.string().cuid() });

function revalidate(requestId: string) {
  revalidatePath(`/faculty/assignments/${requestId}`);
  revalidatePath('/faculty/assignments');
  revalidatePath('/faculty');
  revalidatePath(`/pc/requests/${requestId}`);
  revalidatePath(`/hog/requests/${requestId}`);
  revalidatePath(`/ic/requests/${requestId}`);
  revalidatePath(`/sme/nominations`);
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

/**
 * Parse the FormData's `data` field into a validated `BitsHandoutV1`. Returns
 * either the parsed value or a Zod error message suitable for surfacing in
 * the editor's sticky banner.
 */
function parseDataField(
  formData: FormData,
): { ok: true; data: BitsHandoutV1 } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get('data') ?? ''));
  } catch {
    return { ok: false, error: 'Invalid handout JSON' };
  }
  const parsed = BitsHandoutSchemaV1.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first?.path.join('.') ?? '(root)';
    return { ok: false, error: `${path}: ${first?.message ?? 'invalid'}` };
  }
  return { ok: true, data: parsed.data };
}

export async function saveStructuredDraftAction(formData: FormData) {
  const me = requireRole(await getSessionUser(), RoleName.FACULTY);
  const requestIdParse = idOnlySchema.safeParse({ requestId: formData.get('requestId') });
  if (!requestIdParse.success) return { error: 'Invalid input' };
  const dataParse = parseDataField(formData);
  if (!dataParse.ok) return { error: dataParse.error };
  const notes = String(formData.get('notes') ?? '').slice(0, 1000);

  const request = await loadMyAssignment(requestIdParse.data.requestId, me.id);
  if (!request) return { error: 'Assignment not found' };
  if (!request.handout) return { error: 'Editing has not started yet' };
  if (!EDITABLE_STATUSES.includes(request.status)) {
    return { error: `Cannot save from status ${request.status}` };
  }

  const handoutId = request.handout.id;
  const version = await prisma.$transaction(async (tx) => {
    return appendStructuredVersion(tx, handoutId, me.id, dataParse.data, notes || null);
  });

  await audit({
    actorId: me.id,
    action: 'handout.version.saved',
    entity: 'HandoutVersion',
    entityId: version.id,
    requestId: request.id,
    after: { versionNo: version.versionNo, structured: true },
  });

  revalidate(request.id);
  return { ok: true, versionNo: version.versionNo, savedAt: version.createdAt.toISOString() };
}

export async function submitStructuredForReviewAction(formData: FormData) {
  const me = requireRole(await getSessionUser(), RoleName.FACULTY);
  const requestIdParse = idOnlySchema.safeParse({ requestId: formData.get('requestId') });
  if (!requestIdParse.success) return { error: 'Invalid input' };
  const dataParse = parseDataField(formData);
  if (!dataParse.ok) return { error: dataParse.error };
  const notes = String(formData.get('notes') ?? '').slice(0, 1000);

  const request = await loadMyAssignment(requestIdParse.data.requestId, me.id);
  if (!request) return { error: 'Assignment not found' };
  if (!request.handout) return { error: 'Editing has not started yet' };
  if (!EDITABLE_STATUSES.includes(request.status)) {
    return { error: `Cannot submit from status ${request.status}` };
  }

  try {
    await transition({
      requestId: request.id,
      event: 'SUBMITTED',
      actor: { id: me.id, roles: me.roles },
      effects: async (tx, ctx) => {
        await appendStructuredVersion(
          tx,
          ctx.handoutId,
          me.id,
          dataParse.data,
          notes || 'Submitted for review.',
        );
      },
    });
  } catch (err) {
    if (err instanceof WorkflowError) return { error: err.message };
    throw err;
  }

  await notifyTransition({
    requestId: request.id,
    event: 'SUBMITTED',
    actor: { id: me.id, name: me.name },
  });

  // Fire-and-forget AI quality report on submit. Same convention as the
  // legacy submitForReviewAction (see actions.ts) — queue when
  // WORKERS_ENABLED, otherwise run inline. AiUnconfiguredError swallowed
  // because the noop AI provider is a normal CI / dev state.
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
        await runQualityReport({ handoutVersionId: versionId, bypassRateLimit: true });
      }
    }
  } catch (err) {
    if (!(err instanceof AiUnconfiguredError)) {
      console.error('quality_check_on_submit_failed', err);
    }
  }

  revalidate(request.id);
  return { ok: true };
}

/**
 * Convert a legacy (data: null) HandoutVersion's editor experience to the
 * structured one. Creates a new HandoutVersion with `data` pre-populated
 * from request context (course title, course numbers from
 * bitsCourseNumber + alternateCodes, instructor name, semester) and
 * blank-but-Zod-valid defaults for everything else. Faculty fills in the
 * rest in the structured editor; the legacy editor stays accessible until
 * the first structured save (which is THIS save).
 *
 * Server-derived context — the client doesn't supply it, so faculty
 * cannot tamper with course identity or instructor name through this
 * surface.
 */
export async function convertToStructuredAction(formData: FormData) {
  const me = requireRole(await getSessionUser(), RoleName.FACULTY);
  const parse = idOnlySchema.safeParse({ requestId: formData.get('requestId') });
  if (!parse.success) return { error: 'Invalid input' };

  const request = await prisma.handoutRequest.findUnique({
    where: { id: parse.data.requestId },
    include: {
      offering: { include: { course: true, semester: true } },
      handout: true,
      assignments: { where: { facultyId: me.id, active: true }, take: 1 },
    },
  });
  if (!request) return { error: 'Assignment not found' };
  if (request.assignments.length === 0) return { error: 'Assignment not found' };
  if (!request.handout) return { error: 'Editing has not started yet' };
  if (!EDITABLE_STATUSES.includes(request.status)) {
    return { error: `Cannot convert from status ${request.status}` };
  }

  const data = blankHandoutForRequest({
    courseTitle: request.offering.course.title,
    courseNumbers: [
      request.offering.course.bitsCourseNumber,
      ...request.offering.course.alternateCodes,
    ],
    instructorName: me.name,
    semesterName: request.offering.semester.name,
  });
  const handoutId = request.handout.id;
  const version = await prisma.$transaction(async (tx) => {
    return appendStructuredVersion(
      tx,
      handoutId,
      me.id,
      data,
      'Converted to structured editor (Prompt 11d).',
    );
  });
  await audit({
    actorId: me.id,
    action: 'handout.version.converted_to_structured',
    entity: 'HandoutVersion',
    entityId: version.id,
    requestId: request.id,
    after: { versionNo: version.versionNo },
  });
  revalidate(request.id);
  return { ok: true };
}

/**
 * Prompt 11d-b — generate a structured `BitsHandoutV1` AI draft for the
 * faculty's current assignment. Mirrors `generateAiDraftAction` (legacy
 * TipTap path) but the payload is structured data the faculty applies into
 * the form state instead of HTML for the legacy editor.
 *
 * Failure modes surfaced verbatim:
 *  - AI provider unconfigured → returns a stub draft (caller renders a
 *    neutral banner; this is a normal dev state, not an error).
 *  - AI returns malformed JSON or Zod-invalid output → `chatJson` throws
 *    inside `generateStructuredHandoutDraft`; this action catches and
 *    returns the error message verbatim so the dialog can show the path +
 *    Zod message to faculty.
 */
export async function generateStructuredAiDraftAction(formData: FormData) {
  const me = requireRole(await getSessionUser(), RoleName.FACULTY);
  const parse = z
    .object({
      requestId: z.string().cuid(),
      forceRefresh: z.boolean().optional().default(false),
    })
    .safeParse({
      requestId: formData.get('requestId'),
      forceRefresh: formData.get('forceRefresh') === 'true',
    });
  if (!parse.success) return { error: 'Invalid input' };

  const request = await loadMyAssignment(parse.data.requestId, me.id);
  if (!request) return { error: 'Assignment not found' };
  if (!request.handout) return { error: 'Editing has not started yet' };
  if (!EDITABLE_STATUSES.includes(request.status)) {
    return { error: `Cannot generate from status ${request.status}` };
  }

  try {
    const result = await generateStructuredHandoutDraft({
      handoutId: request.handout.id,
      forceRefresh: parse.data.forceRefresh,
    });
    await audit({
      actorId: me.id,
      action: 'ai.draft.generated.structured',
      entity: 'AIDraftLog',
      entityId: result.draftId,
      requestId: request.id,
      after: { model: result.model, source: result.source },
    });
    return {
      ok: true,
      draftId: result.draftId,
      data: result.data,
      source: result.source,
      model: result.model,
    };
  } catch (err) {
    if (err instanceof AiUnconfiguredError) {
      return { error: 'AI provider not configured. Ask admin to set AI_PROVIDER + API key.' };
    }
    return { error: err instanceof Error ? err.message : 'Structured draft generation failed' };
  }
}

/**
 * Apply a previously-generated structured draft to the handout — persists as
 * a NEW HandoutVersion via `appendStructuredVersion`. The legacy
 * `applyAiDraftAction` (which writes from `payload.tiptapJson`) is left
 * untouched; this action dispatches on the new `payload.data` shape and
 * uses the structured persistence path.
 */
export async function applyStructuredAiDraftAction(formData: FormData) {
  const me = requireRole(await getSessionUser(), RoleName.FACULTY);
  const parse = z.object({ requestId: z.string().cuid(), draftId: z.string().cuid() }).safeParse({
    requestId: formData.get('requestId'),
    draftId: formData.get('draftId'),
  });
  if (!parse.success) return { error: 'Invalid input' };

  const request = await loadMyAssignment(parse.data.requestId, me.id);
  if (!request) return { error: 'Assignment not found' };
  if (!request.handout) return { error: 'Editing has not started yet' };
  if (!EDITABLE_STATUSES.includes(request.status)) {
    return { error: `Cannot apply structured draft from status ${request.status}` };
  }

  const draft = await prisma.aIDraftLog.findUnique({ where: { id: parse.data.draftId } });
  if (!draft || draft.handoutId !== request.handout.id) {
    return { error: 'Draft not found' };
  }
  const payload = draft.payload as { data?: unknown } | null;
  if (!payload?.data) {
    return { error: 'Draft has no structured data — was this a legacy TipTap draft?' };
  }
  const parsedData = BitsHandoutSchemaV1.safeParse(payload.data);
  if (!parsedData.success) {
    const first = parsedData.error.issues[0];
    return {
      error: `Draft data is malformed: ${first?.path.join('.') ?? '(root)'}: ${first?.message ?? 'invalid'}`,
    };
  }

  const handoutId = request.handout.id;
  const version = await prisma.$transaction(async (tx) => {
    return appendStructuredVersion(
      tx,
      handoutId,
      me.id,
      parsedData.data,
      `AI-generated structured draft (${draft.source} · ${draft.model})`,
    );
  });
  await audit({
    actorId: me.id,
    action: 'ai.draft.applied.structured',
    entity: 'HandoutVersion',
    entityId: version.id,
    requestId: request.id,
    after: { versionNo: version.versionNo, draftId: draft.id, source: draft.source },
  });

  revalidate(request.id);
  return { ok: true, versionNo: version.versionNo };
}

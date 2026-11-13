import { prisma, HandoutStatus, RoleName } from '@hmp/db';
import { loadMailContext } from './email/context';
import { autoPublishStoppedEmail } from './email/other';
import { loadRequestFacts } from './email/request-facts';
import { enqueueScheduleJob } from '@hmp/queue';
import { TaxilaError } from '@hmp/integrations';
// Relative imports only: the worker (tsx) runs this.
import {
  loadPublishTarget,
  publishRequestToTaxila,
  taxilaClient,
  taxilaSettings,
} from './taxila-publish';
import { outcomeStatus } from './taxila-runs';
import { deliverToUsers, instructionCellIds } from './notifications';

/**
 * v1.4.2 — auto-publish (F11, H23; docs/plans/v1.4.2-workload.md §10). Off by default. When on and Taxila is
 * set up, a final approval queues one publish: the same check and publish as the IC's button (one
 * "Course Handout.pdf", read-back confirm, faculty told). It acts for the Instruction Cell member who raised
 * the request (else the first active IC member). Anything but a confirmed publish leaves the handout
 * Approved, records the reason in an automatic run (Earlier runs) and tells the IC; nothing retries on its own.
 */

export async function autoPublishOn(): Promise<boolean> {
  if (!taxilaSettings()) return false;
  const cfg = await prisma.workflowConfig.findUnique({
    where: { key: 'default' },
    select: { autoPublish: true },
  });
  return !!cfg?.autoPublish;
}

/** Called right after a final approval (single or bulk). Never throws into the approval. */
export async function queueAutoPublish(requestId: string): Promise<void> {
  try {
    if (!(await autoPublishOn())) return;
    if (process.env.WORKERS_ENABLED === 'true') {
      try {
        await enqueueScheduleJob(
          { kind: 'auto_publish', requestId, actor: { id: 'system', name: 'Auto-publish' } },
          `auto-publish:${requestId}:${Date.now()}`,
        );
        return;
      } catch (err) {
        console.error('[auto-publish] enqueue failed — running in the background', err);
      }
    }
    // No worker: run after the page has answered (never slows the approval down).
    void autoPublish(requestId).catch((err) => console.error('[auto-publish] failed', err));
  } catch (err) {
    console.error('[auto-publish] not queued', err);
  }
}

async function actingIc(initiatedById: string) {
  const ic = { roles: { some: { role: { name: RoleName.INSTRUCTION_CELL } } } };
  return (
    (await prisma.user.findFirst({
      where: { id: initiatedById, active: true, ...ic },
      select: { id: true, name: true },
    })) ??
    (await prisma.user.findFirst({
      where: { active: true, ...ic },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true },
    }))
  );
}

export type AutoPublishResult =
  | { status: 'off' | 'not-approved' | 'no-ic' }
  | { status: string; runId: string; message: string };

export async function autoPublish(requestId: string): Promise<AutoPublishResult> {
  const cfg = taxilaSettings();
  if (!cfg || !(await autoPublishOn())) return { status: 'off' };
  const target = await loadPublishTarget(requestId);
  if (!target || target.status !== HandoutStatus.APPROVED) return { status: 'not-approved' };
  const req = await prisma.handoutRequest.findUniqueOrThrow({
    where: { id: requestId },
    select: { initiatedById: true },
  });
  const actor = await actingIc(req.initiatedById);
  if (!actor) return { status: 'no-ic' };

  const semesterCode = target.courseChoice
    ? target.defaultSemesterCode || '—'
    : target.defaultSemesterCode;
  const run = await prisma.taxilaPublishRun.create({
    data: {
      createdById: actor.id,
      semesterCode: semesterCode || '—',
      auto: true,
      items: { create: { requestId, position: 0, status: 'WORKING' } },
    },
    select: { id: true, items: { select: { id: true } } },
  });
  const itemId = run.items[0]!.id;

  let status: string;
  let message: string;
  let step: string | null = null;
  let course: { fullname: string; id: number } | null = null;
  if (!semesterCode && !target.courseChoice) {
    status = 'NOT_FOUND';
    step = 'search';
    message =
      'HMP can’t work out the Taxila semester code for this semester (e.g. Summer). Type it on the request and publish.';
  } else {
    try {
      const out = await publishRequestToTaxila(
        target,
        {
          semesterCode,
          actor: { id: actor.id, name: actor.name, roles: [RoleName.INSTRUCTION_CELL] },
        },
        taxilaClient(cfg),
        cfg,
      );
      status = outcomeStatus(out);
      message = out.message;
      step = 'step' in out ? (out.step ?? null) : null;
      course = out.course ?? null;
    } catch (err) {
      status = 'FAILED';
      step = err instanceof TaxilaError ? err.step : null;
      message = err instanceof TaxilaError ? err.message : 'Something went wrong while publishing.';
    }
  }
  await prisma.taxilaPublishItem.update({
    where: { id: itemId },
    data: {
      status,
      step,
      message,
      courseFullname: course?.fullname ?? null,
      taxilaCourseId: course?.id ?? null,
    },
  });
  await prisma.taxilaPublishRun.update({
    where: { id: run.id },
    data: { status: 'DONE', finishedAt: new Date() },
  });
  await prisma.auditLog.create({
    data: {
      actorId: actor.id,
      action: status === 'PUBLISHED' ? 'request.auto-published' : 'request.auto-publish-stopped',
      entity: 'HandoutRequest',
      entityId: requestId,
      requestId,
      after: { runId: run.id, status, message },
    },
  });
  if (status !== 'PUBLISHED') {
    const [facts, ctx] = await Promise.all([
      loadRequestFacts(requestId),
      loadMailContext('Auto-publish'),
    ]);
    await deliverToUsers(await instructionCellIds(), RoleName.INSTRUCTION_CELL, {
      requestId,
      subject: `Auto-publish needs you: ${target.refNo} ${target.codes[0] ?? ''}`,
      body: `${target.refNo} (${target.codes[0] ?? ''} ${target.courseTitle}) was approved but not published automatically: ${message}`,
      metaKind: 'taxila.auto-publish',
      extraMeta: { runId: run.id, status },
      urgent: true,
      mail: (to) => (facts ? autoPublishStoppedEmail(facts, to, { reason: message }, ctx) : null),
    });
  }
  return { status, runId: run.id, message };
}

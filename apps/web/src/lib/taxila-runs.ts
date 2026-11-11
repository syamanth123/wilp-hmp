import { prisma, HandoutStatus, NotificationChannel, RoleName } from '@hmp/db';
import { deliver } from './notifications';
import { PROBLEM_STATUSES, finishedLine, summariseRun } from './taxila-run-summary';
import {
  TaxilaError,
  type TaxilaClient,
  type TaxilaConfig,
  type TaxilaCourse,
} from '@hmp/integrations';
import {
  checkRequestInTaxila,
  loadPublishTarget,
  publishRequestToTaxila,
  type PublishOutcome,
} from './taxila-publish';

/**
 * Bulk publish to Taxila (v1.3.0, docs/plans/taxila-publish.md §B3). The IC's browser asks for one
 * course at a time ("process the next item"); every result is saved on its TaxilaPublishItem, so a
 * closed tab only pauses the run and reopening it carries on. Nothing is published twice: an item
 * is claimed before it is worked on, and publishing re-checks Taxila and the handout's status.
 */

export const ITEM_STATUS = {
  PENDING: 'PENDING',
  WORKING: 'WORKING',
  READY: 'READY',
  PUBLISHED: 'PUBLISHED',
  NOT_FOUND: 'NOT_FOUND',
  AMBIGUOUS: 'AMBIGUOUS',
  ITEM_MISSING: 'ITEM_MISSING',
  OTHER_FILES: 'OTHER_FILES',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
} as const;
export type ItemStatus = (typeof ITEM_STATUS)[keyof typeof ITEM_STATUS];

export const ITEM_LABEL: Record<ItemStatus, string> = {
  PENDING: 'Waiting',
  WORKING: 'Working…',
  READY: 'Ready to publish',
  PUBLISHED: 'Published',
  NOT_FOUND: 'Course not found',
  AMBIGUOUS: 'Several courses match',
  ITEM_MISSING: 'No Course Handout item',
  OTHER_FILES: 'Other files in Course Handout',
  FAILED: 'Failed',
  SKIPPED: 'Skipped',
};

/** Items a "Check all" pass looks at, and items "Publish all" works through. */
const TO_CHECK: ItemStatus[] = ['PENDING'];
const TO_PUBLISH: ItemStatus[] = ['PENDING', 'READY'];
/** A claimed item whose request died (server restart) is free again after this long. */
const STALE_MS = 3 * 60_000;

/** One course search per run (and semester code), kept for a while in this server process. */
const searchCache = new Map<string, { at: number; courses: TaxilaCourse[] }>();
async function coursesFor(runId: string, semesterCode: string, client: TaxilaClient) {
  const key = `${runId}|${semesterCode}`;
  const hit = searchCache.get(key);
  if (hit && Date.now() - hit.at < 15 * 60_000) return hit.courses;
  const courses = await client.searchCourses(semesterCode);
  searchCache.set(key, { at: Date.now(), courses });
  return courses;
}

export async function createTaxilaRun(input: {
  actorId: string;
  semesterCode: string;
  requestIds: string[];
}): Promise<{ ok: true; runId: string } | { ok: false; error: string }> {
  const ids = [...new Set(input.requestIds)].slice(0, 500);
  if (ids.length === 0) return { ok: false, error: 'Tick at least one approved handout.' };
  const approved = await prisma.handoutRequest.findMany({
    where: { id: { in: ids }, status: HandoutStatus.APPROVED },
    select: { id: true, refNo: true },
    orderBy: { refNo: 'asc' },
  });
  if (approved.length === 0)
    return { ok: false, error: 'None of the ticked handouts is approved.' };
  const run = await prisma.taxilaPublishRun.create({
    data: {
      createdById: input.actorId,
      semesterCode: input.semesterCode,
      items: {
        create: approved.map((r, i) => ({ requestId: r.id, position: i + 1 })),
      },
    },
    select: { id: true },
  });
  return { ok: true, runId: run.id };
}

export const outcomeStatus = (o: PublishOutcome): ItemStatus =>
  ({
    published: 'PUBLISHED',
    'not-found': 'NOT_FOUND',
    ambiguous: 'AMBIGUOUS',
    'item-missing': 'ITEM_MISSING',
    'other-files': 'OTHER_FILES',
    failed: 'FAILED',
    'not-approved': 'SKIPPED',
    'no-content': 'FAILED',
  })[o.status] as ItemStatus;

export interface StepResult {
  done: boolean;
  itemId?: string;
}

/**
 * Works on the next item of the run: 'check' finds the course and its item (no upload); 'publish'
 * publishes it. Returns done as soon as nothing is left for this mode — in the same answer as the
 * last course, so the page settles at once. When a publish pass finishes, the run is marked DONE and
 * the IC who started it gets a short summary (once per finish).
 */
export async function processNextItem(
  runId: string,
  mode: 'check' | 'publish',
  actor: { id: string; name: string; roles: RoleName[] },
  client: TaxilaClient,
  cfg: TaxilaConfig,
): Promise<StepResult> {
  const r = await processOneItem(runId, mode, actor, client, cfg);
  if (!r.done && !r.itemId) return r; // another tab took the item; ask again
  const left = await prisma.taxilaPublishItem.count({
    where: { runId, status: { in: [...(mode === 'check' ? TO_CHECK : TO_PUBLISH), 'WORKING'] } },
  });
  if (left > 0) return r;
  if (mode === 'publish') {
    // Only the request that flips the run to DONE sends the summary.
    const flipped = await prisma.taxilaPublishRun.updateMany({
      where: { id: runId, status: { not: 'DONE' } },
      data: { status: 'DONE', finishedAt: new Date() },
    });
    if (flipped.count === 1) await notifyRunFinished(runId);
  }
  return { ...r, done: true };
}

async function processOneItem(
  runId: string,
  mode: 'check' | 'publish',
  actor: { id: string; name: string; roles: RoleName[] },
  client: TaxilaClient,
  cfg: TaxilaConfig,
): Promise<StepResult> {
  const run = await prisma.taxilaPublishRun.findUnique({ where: { id: runId } });
  if (!run) return { done: true };
  // Free items left half-way by a server restart.
  await prisma.taxilaPublishItem.updateMany({
    where: { runId, status: 'WORKING', updatedAt: { lt: new Date(Date.now() - STALE_MS) } },
    data: { status: 'PENDING' },
  });

  const wanted = mode === 'check' ? TO_CHECK : TO_PUBLISH;
  const next = await prisma.taxilaPublishItem.findFirst({
    where: { runId, status: { in: wanted } },
    orderBy: { position: 'asc' },
  });
  if (!next) return { done: true };
  // Claim it — a second tab on the same run can't take the same item.
  const claimed = await prisma.taxilaPublishItem.updateMany({
    where: { id: next.id, status: next.status },
    data: { status: 'WORKING' },
  });
  if (claimed.count === 0) return { done: false };

  const save = (data: {
    status: ItemStatus;
    step?: string | null;
    message?: string | null;
    fileName?: string | null;
    courseFullname?: string | null;
    taxilaCourseId?: number | null;
  }) => prisma.taxilaPublishItem.update({ where: { id: next.id }, data });

  try {
    const target = await loadPublishTarget(next.requestId);
    if (!target) {
      await save({ status: 'SKIPPED', message: 'The request no longer exists.' });
      return { done: false, itemId: next.id };
    }
    const courses = await coursesFor(runId, run.semesterCode, client);
    if (mode === 'check') {
      if (target.status !== HandoutStatus.APPROVED) {
        await save({ status: 'SKIPPED', message: 'No longer approved (already published?).' });
        return { done: false, itemId: next.id };
      }
      const { check, fileName } = await checkRequestInTaxila(
        target,
        { semesterCode: run.semesterCode, courses },
        client,
        cfg,
      );
      const course = 'course' in check ? check.course : undefined;
      await save({
        status:
          check.status === 'ready'
            ? 'READY'
            : check.status === 'ambiguous'
              ? 'AMBIGUOUS'
              : check.status === 'item-missing'
                ? 'ITEM_MISSING'
                : check.status === 'other-files'
                  ? 'OTHER_FILES'
                  : 'NOT_FOUND',
        step:
          check.status === 'ready'
            ? null
            : check.status === 'item-missing' || check.status === 'other-files'
              ? 'item'
              : 'search',
        message: check.message,
        fileName,
        courseFullname: course?.fullname ?? null,
        taxilaCourseId: course?.id ?? null,
      });
      return { done: false, itemId: next.id };
    }

    const out = await publishRequestToTaxila(
      target,
      { semesterCode: run.semesterCode, courses, actor },
      client,
      cfg,
    );
    await save({
      status: outcomeStatus(out),
      step: 'step' in out ? (out.step ?? null) : null,
      message: out.message,
      fileName: 'fileName' in out ? out.fileName : null,
      courseFullname: out.course?.fullname ?? null,
      taxilaCourseId: out.course?.id ?? null,
    });
    return { done: false, itemId: next.id };
  } catch (err) {
    await save({
      status: 'FAILED',
      step: err instanceof TaxilaError ? err.step : null,
      message: err instanceof TaxilaError ? err.message : 'Something went wrong on this course.',
    });
    return { done: false, itemId: next.id };
  }
}

/** The IC who started the run hears how it ended (in HMP and by email). */
async function notifyRunFinished(runId: string): Promise<void> {
  const run = await loadRun(runId);
  const creator = await prisma.taxilaPublishRun.findUnique({
    where: { id: runId },
    select: { createdBy: { select: { id: true, email: true } } },
  });
  if (!run || !creator) return;
  const sum = summariseRun(run.rows);
  const problems = run.rows.filter((r) => PROBLEM_STATUSES.includes(r.status));
  const body = [
    `Bulk publish to Taxila (${run.semesterCode}) has finished: ${finishedLine(sum)}.`,
    ...problems
      .slice(0, 10)
      .map(
        (p) => `${p.codes.join(' / ')} (${p.refNo}) — ${ITEM_LABEL[p.status]}: ${p.message ?? ''}`,
      ),
    problems.length > 10 ? `…and ${problems.length - 10} more (see the run page).` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  await deliver({
    userId: creator.createdBy.id,
    email: creator.createdBy.email,
    role: RoleName.INSTRUCTION_CELL,
    subject: `Bulk publish to Taxila finished: ${finishedLine(sum)}`,
    body,
    link: `/ic/taxila-runs/${runId}`,
    channels: [NotificationChannel.IN_PORTAL, NotificationChannel.EMAIL],
    metaKind: 'taxila_run_finished',
    extraMeta: { runId },
  });
}

/** "Try these again": problem items go back to waiting (published ones never do). */
export async function retryProblemItems(runId: string): Promise<number> {
  const r = await prisma.taxilaPublishItem.updateMany({
    where: { runId, status: { in: PROBLEM_STATUSES } },
    data: { status: 'PENDING', step: null, message: null },
  });
  if (r.count)
    await prisma.taxilaPublishRun.update({
      where: { id: runId },
      data: { status: 'RUNNING', finishedAt: null },
    });
  searchCache.forEach((_, k) => k.startsWith(`${runId}|`) && searchCache.delete(k));
  return r.count;
}

export interface RunRow {
  id: string;
  position: number;
  requestId: string;
  refNo: string;
  codes: string[];
  courseTitle: string;
  semesterName: string;
  status: ItemStatus;
  step: string | null;
  message: string | null;
  fileName: string | null;
  courseFullname: string | null;
  taxilaCourseId: number | null;
}

export async function loadRun(runId: string) {
  const run = await prisma.taxilaPublishRun.findUnique({
    where: { id: runId },
    include: {
      createdBy: { select: { name: true } },
      items: {
        orderBy: { position: 'asc' },
        include: {
          request: {
            select: {
              refNo: true,
              offering: {
                select: {
                  course: { select: { bitsCourseNumber: true, alternateCodes: true, title: true } },
                  semester: { select: { name: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!run) return null;
  const rows: RunRow[] = run.items.map((i) => ({
    id: i.id,
    position: i.position,
    requestId: i.requestId,
    refNo: i.request.refNo,
    codes: [
      i.request.offering.course.bitsCourseNumber,
      ...i.request.offering.course.alternateCodes,
    ],
    courseTitle: i.request.offering.course.title,
    semesterName: i.request.offering.semester.name,
    status: i.status as ItemStatus,
    step: i.step,
    message: i.message,
    fileName: i.fileName,
    courseFullname: i.courseFullname,
    taxilaCourseId: i.taxilaCourseId,
  }));
  return {
    id: run.id,
    semesterCode: run.semesterCode,
    status: run.status,
    createdAt: run.createdAt,
    finishedAt: run.finishedAt,
    createdBy: run.createdBy.name,
    rows,
  };
}

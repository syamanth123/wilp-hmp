import {
  prisma,
  ApprovalDecision,
  ApprovalStage,
  BitsHandoutSchemaV1,
  HandoutStatus,
  LmsPublishMode,
  type BitsHandoutV1,
  type Prisma,
  type RoleName,
} from '@hmp/db';
import {
  TaxilaError,
  checkInTaxila,
  createTaxilaClient,
  defaultTaxilaSemesterCode,
  nextFreeFileName,
  publishFileToTaxila,
  redact,
  taxilaConfigFromEnv,
  taxilaFileName,
  type CheckResult,
  type TaxilaClient,
  type TaxilaConfig,
  type TaxilaCourse,
} from '@hmp/integrations';
import { transition, WorkflowError } from '@hmp/workflow';
import { buildApprovedHandoutPdf } from './export/handout-pdf';
import { notifyTransition } from './notifications';

/**
 * Publishing an approved handout into its Taxila course folder — "Mode C", v1.3.0
 * (docs/plans/taxila-publish.md §B2). Used by the IC's request page (one handout) and the bulk run
 * (one item at a time). Every publish re-checks Taxila first; nothing is uploaded twice.
 */

export interface PublishTarget {
  requestId: string;
  refNo: string;
  status: HandoutStatus;
  handoutId: string | null;
  /** The course's codes, catalogue code first (cross-listings after it). */
  codes: string[];
  courseTitle: string;
  semesterName: string;
  defaultSemesterCode: string;
  data: BitsHandoutV1 | null;
}

export function taxilaSettings(): TaxilaConfig | null {
  return taxilaConfigFromEnv();
}

export async function loadPublishTarget(requestId: string): Promise<PublishTarget | null> {
  const r = await prisma.handoutRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      refNo: true,
      status: true,
      handout: { select: { id: true, currentVersion: { select: { data: true } } } },
      offering: {
        select: {
          course: { select: { bitsCourseNumber: true, alternateCodes: true, title: true } },
          semester: { select: { name: true } },
        },
      },
    },
  });
  if (!r) return null;
  const parsed = r.handout?.currentVersion?.data
    ? BitsHandoutSchemaV1.safeParse(r.handout.currentVersion.data)
    : null;
  const c = r.offering.course;
  return {
    requestId: r.id,
    refNo: r.refNo,
    status: r.status,
    handoutId: r.handout?.id ?? null,
    codes: [...new Set([c.bitsCourseNumber, ...c.alternateCodes])],
    courseTitle: c.title,
    semesterName: r.offering.semester.name,
    defaultSemesterCode: defaultTaxilaSemesterCode(r.offering.semester.name),
    data: parsed?.success ? parsed.data : null,
  };
}

export interface CheckView {
  check: CheckResult;
  /** The name the file gets (the plain one). */
  fileName: string;
  /** When it's already there: the name "Publish as new version" would use. */
  newVersionName: string | null;
}

/** "Check in Taxila" for one handout — nothing is uploaded. */
export async function checkRequestInTaxila(
  target: PublishTarget,
  input: { semesterCode: string; courseId?: number; courses?: TaxilaCourse[] },
  client: TaxilaClient,
  cfg: TaxilaConfig,
): Promise<CheckView> {
  const fileName = taxilaFileName(target.codes, target.semesterName);
  const check = await checkInTaxila(client, cfg, {
    semesterCode: input.semesterCode,
    codes: target.codes,
    fileName,
    courses: input.courses,
    courseId: input.courseId,
  });
  return {
    check,
    fileName,
    newVersionName:
      check.status === 'already-there'
        ? nextFreeFileName(target.codes, target.semesterName, check.folder.files)
        : null,
  };
}

export type PublishOutcome =
  | {
      status: 'published' | 'already-there';
      message: string;
      fileName: string;
      course: TaxilaCourse;
      courseUrl: string;
    }
  | {
      status:
        | 'not-found'
        | 'ambiguous'
        | 'folder-missing'
        | 'failed'
        | 'not-approved'
        | 'no-content';
      message: string;
      step?: string;
      course?: TaxilaCourse;
      courseUrl?: string;
      courses?: TaxilaCourse[];
    };

interface Actor {
  id: string;
  name: string;
  roles: RoleName[];
}

async function logFailure(
  target: PublishTarget,
  info: {
    step: string;
    message: string;
    semesterCode: string;
    fileName?: string;
    course?: TaxilaCourse;
  },
) {
  if (!target.handoutId) return;
  await prisma.lmsPublishLog.create({
    data: {
      handoutId: target.handoutId,
      status: 'failed',
      mode: LmsPublishMode.TAXILA_FOLDER,
      responseJson: {
        step: info.step,
        message: info.message,
        refNo: target.refNo,
        semesterCode: info.semesterCode,
        fileName: info.fileName ?? null,
        taxilaCourseId: info.course?.id ?? null,
      } as Prisma.InputJsonValue,
    },
  });
}

/**
 * Publish one approved handout: re-check → PDF → upload → move → PUBLISHED (+ log, approval, audit)
 * → faculty notified. Already there and no new version asked → nothing is uploaded.
 */
export async function publishRequestToTaxila(
  target: PublishTarget,
  input: {
    semesterCode: string;
    courseId?: number;
    newVersion?: boolean;
    courses?: TaxilaCourse[];
    actor: Actor;
  },
  client: TaxilaClient,
  cfg: TaxilaConfig,
): Promise<PublishOutcome> {
  const { semesterCode } = input;
  if (target.status !== HandoutStatus.APPROVED)
    return {
      status: 'not-approved',
      message:
        target.status === HandoutStatus.PUBLISHED
          ? 'Already published.'
          : 'Only approved handouts can be published.',
    };
  if (!target.data || !target.handoutId)
    return {
      status: 'no-content',
      message: 'This handout has no sectioned content to turn into a PDF.',
    };

  let view: CheckView;
  try {
    view = await checkRequestInTaxila(target, input, client, cfg);
  } catch (err) {
    const message = err instanceof TaxilaError ? err.message : redact(String(err), cfg.token);
    const step = err instanceof TaxilaError ? err.step : 'search';
    await logFailure(target, { step, message, semesterCode });
    return { status: 'failed', step, message };
  }
  const { check } = view;
  if (check.status === 'not-found' || check.status === 'ambiguous') {
    await logFailure(target, { step: 'search', message: check.message, semesterCode });
    return check.status === 'ambiguous'
      ? { status: 'ambiguous', message: check.message, courses: check.courses }
      : { status: 'not-found', message: check.message };
  }
  if (check.status === 'folder-missing') {
    await logFailure(target, {
      step: 'folder',
      message: check.message,
      semesterCode,
      course: check.course,
    });
    return {
      status: 'folder-missing',
      message: check.message,
      course: check.course,
      courseUrl: check.courseUrl,
    };
  }
  if (check.status === 'already-there' && !input.newVersion)
    return {
      status: 'already-there',
      message: 'Already in Taxila.',
      fileName: view.fileName,
      course: check.course,
      courseUrl: check.courseUrl,
    };
  const fileName = check.status === 'already-there' ? view.newVersionName! : view.fileName;

  let pdf: Buffer;
  try {
    pdf = await buildApprovedHandoutPdf(target.data);
  } catch (err) {
    const message = `Couldn't make the PDF: ${(err as Error).message}`;
    await logFailure(target, {
      step: 'pdf',
      message,
      semesterCode,
      fileName,
      course: check.course,
    });
    return { status: 'failed', step: 'pdf', message };
  }

  try {
    await publishFileToTaxila(client, {
      courseId: check.course.id,
      contextid: check.folder.contextid,
      fileName,
      pdf,
    });
  } catch (err) {
    const message = err instanceof TaxilaError ? err.message : redact(String(err), cfg.token);
    const step = err instanceof TaxilaError ? err.step : 'upload';
    await logFailure(target, { step, message, semesterCode, fileName, course: check.course });
    return { status: 'failed', step, message, course: check.course, courseUrl: check.courseUrl };
  }

  try {
    await transition({
      requestId: target.requestId,
      event: 'PUBLISHED',
      actor: { id: input.actor.id, roles: input.actor.roles },
      effects: async (tx, ctx) => {
        await tx.lmsPublishLog.create({
          data: {
            handoutId: ctx.handoutId,
            status: 'success',
            mode: LmsPublishMode.TAXILA_FOLDER,
            externalRef: check.courseUrl,
            responseJson: {
              refNo: target.refNo,
              taxilaCourseId: check.course.id,
              courseFullname: check.course.fullname,
              courseUrl: check.courseUrl,
              folder: cfg.folderName,
              contextid: check.folder.contextid,
              fileName,
              semesterCode,
            } as Prisma.InputJsonValue,
          },
        });
        await tx.approval.create({
          data: {
            requestId: target.requestId,
            stage: ApprovalStage.IC_PUBLISH,
            decision: ApprovalDecision.APPROVED,
            reviewerId: input.actor.id,
            decidedAt: new Date(),
          },
        });
      },
    });
  } catch (err) {
    // The file IS in Taxila; say so plainly rather than hide it.
    const why = err instanceof WorkflowError ? err.message : String(err);
    const message = `The file is in Taxila (${fileName}), but HMP couldn't mark the handout published: ${why}`;
    await logFailure(target, {
      step: 'status',
      message,
      semesterCode,
      fileName,
      course: check.course,
    });
    return {
      status: 'failed',
      step: 'status',
      message,
      course: check.course,
      courseUrl: check.courseUrl,
    };
  }

  // Faculty and the initiator hear about it; emails go out after this returns (lib/notifications).
  await notifyTransition({
    requestId: target.requestId,
    event: 'PUBLISHED',
    actor: { id: input.actor.id, name: input.actor.name },
  });
  return {
    status: 'published',
    message: `Published to Taxila as “${fileName}”.`,
    fileName,
    course: check.course,
    courseUrl: check.courseUrl,
  };
}

export function taxilaClient(cfg: TaxilaConfig): TaxilaClient {
  return createTaxilaClient(cfg);
}

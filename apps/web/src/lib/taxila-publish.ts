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
  TAXILA_HANDOUT_FILE,
  TAXILA_HANDOUT_ITEM,
  TaxilaError,
  checkInTaxila,
  createTaxilaClient,
  defaultTaxilaSemesterCode,
  publishFileToTaxila,
  redact,
  taxilaConfigFromEnv,
  type CheckResult,
  type TaxilaClient,
  type TaxilaConfig,
  type TaxilaCourse,
} from '@hmp/integrations';
import { transition, WorkflowError } from '@hmp/workflow';
import { buildApprovedHandoutPdf } from './export/handout-pdf';
import { notifyTransition } from './notifications';

/**
 * Publishing an approved handout into its Taxila course's "Course Handout" File item — "Mode C"
 * (docs/plans/taxila-publish.md §B2; fixed-name rule v1.3.1). Used by the IC's request page (one
 * handout) and the bulk run (one item at a time). Every publish re-checks Taxila first, always
 * uploads "Course Handout.pdf" (replacing the one there) and reads the item back before the
 * handout counts as published.
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
  /** v1.4.1: the course offering, and the Taxila course chosen for it ("Choose a different Taxila course"). */
  courseOfferingId: string;
  courseChoice: CourseChoice | null;
}

export interface CourseChoice {
  course: TaxilaCourse;
  chosenBy: string | null;
  chosenAt: Date;
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
          id: true,
          taxilaCourseChoice: {
            select: {
              taxilaCourseId: true,
              taxilaFullname: true,
              updatedAt: true,
              chosenBy: { select: { name: true } },
            },
          },
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
    courseOfferingId: r.offering.id,
    courseChoice: choiceOf(r.offering.taxilaCourseChoice),
  };
}

function choiceOf(
  c: {
    taxilaCourseId: number;
    taxilaFullname: string;
    updatedAt: Date;
    chosenBy: { name: string } | null;
  } | null,
): CourseChoice | null {
  if (!c) return null;
  return {
    course: { id: c.taxilaCourseId, fullname: c.taxilaFullname, shortname: '' },
    chosenBy: c.chosenBy?.name ?? null,
    chosenAt: c.updatedAt,
  };
}

export interface CheckView {
  check: CheckResult;
  /** Always "Course Handout.pdf". */
  fileName: string;
  /** v1.4.1: set when the course was chosen by the IC rather than matched by name. */
  choice: { fullname: string; chosenBy: string | null; chosenAt: string } | null;
}

/** "Check in Taxila" for one handout — nothing is uploaded. */
export async function checkRequestInTaxila(
  target: PublishTarget,
  input: { semesterCode: string; courseId?: number; courses?: TaxilaCourse[] },
  client: TaxilaClient,
  cfg: TaxilaConfig,
): Promise<CheckView> {
  // A remembered choice wins over matching by name (v1.4.1) — unless the IC is picking right now.
  const chosen = !input.courseId ? target.courseChoice : null;
  const check = await checkInTaxila(client, cfg, {
    semesterCode: input.semesterCode,
    codes: target.codes,
    courses: input.courses,
    courseId: input.courseId,
    chosen: chosen?.course,
  });
  return {
    check,
    fileName: TAXILA_HANDOUT_FILE,
    choice: chosen
      ? {
          fullname: chosen.course.fullname,
          chosenBy: chosen.chosenBy,
          chosenAt: chosen.chosenAt.toISOString(),
        }
      : null,
  };
}

// ── v1.4.1: "Choose a different Taxila course" (IC / Admin) ─────────────────

/** Taxila courses whose name contains the text — the same search the HMP token already uses. */
export async function searchTaxilaCourses(
  client: TaxilaClient,
  query: string,
): Promise<TaxilaCourse[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  const found = await client.searchCourses(q);
  return found.slice(0, 50);
}

/**
 * Remembers the Taxila course for this course + semester. The id is looked up again on the server
 * (in a search for `query`), so only a course Taxila really returned can be saved. Audit-logged.
 */
export async function saveTaxilaCourseChoice(
  target: PublishTarget,
  input: { taxilaCourseId: number; query: string; actorId: string },
  client: TaxilaClient,
): Promise<{ ok: true; course: TaxilaCourse } | { ok: false; error: string }> {
  const found = await client.searchCourses(input.query.trim());
  const course = found.find((c) => c.id === input.taxilaCourseId);
  if (!course) return { ok: false, error: 'That Taxila course wasn’t found — search again.' };
  await prisma.$transaction([
    prisma.taxilaCourseChoice.upsert({
      where: { courseOfferingId: target.courseOfferingId },
      update: {
        taxilaCourseId: course.id,
        taxilaFullname: course.fullname,
        chosenById: input.actorId,
      },
      create: {
        courseOfferingId: target.courseOfferingId,
        taxilaCourseId: course.id,
        taxilaFullname: course.fullname,
        chosenById: input.actorId,
      },
    }),
    prisma.auditLog.create({
      data: {
        actorId: input.actorId,
        action: 'taxila.course-choice',
        entity: 'CourseOffering',
        entityId: target.courseOfferingId,
        requestId: target.requestId,
        before: target.courseChoice
          ? ({
              taxilaCourseId: target.courseChoice.course.id,
              fullname: target.courseChoice.course.fullname,
            } as Prisma.InputJsonValue)
          : undefined,
        after: { taxilaCourseId: course.id, fullname: course.fullname } as Prisma.InputJsonValue,
      },
    }),
  ]);
  return { ok: true, course };
}

/** Back to matching by name. Audit-logged. */
export async function clearTaxilaCourseChoice(target: PublishTarget, actorId: string) {
  if (!target.courseChoice) return;
  await prisma.$transaction([
    prisma.taxilaCourseChoice.deleteMany({ where: { courseOfferingId: target.courseOfferingId } }),
    prisma.auditLog.create({
      data: {
        actorId,
        action: 'taxila.course-choice-cleared',
        entity: 'CourseOffering',
        entityId: target.courseOfferingId,
        requestId: target.requestId,
        before: {
          taxilaCourseId: target.courseChoice.course.id,
          fullname: target.courseChoice.course.fullname,
        } as Prisma.InputJsonValue,
      },
    }),
  ]);
}

export type PublishOutcome =
  | {
      status: 'published';
      message: string;
      fileName: string;
      course: TaxilaCourse;
      courseUrl: string;
    }
  | {
      status:
        | 'not-found'
        | 'ambiguous'
        | 'item-missing'
        | 'other-files'
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
 * Publish one approved handout: re-check → PDF → upload "Course Handout.pdf" → move (replaces the
 * one there) → read back → PUBLISHED (+ log, approval, audit) → faculty notified. Blocked while the
 * item holds any other file; nothing is uploaded then.
 */
export async function publishRequestToTaxila(
  target: PublishTarget,
  input: {
    semesterCode: string;
    courseId?: number;
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
  if (check.status === 'item-missing' || check.status === 'other-files') {
    await logFailure(target, {
      step: 'item',
      message: check.message,
      semesterCode,
      course: check.course,
    });
    return {
      status: check.status,
      message: check.message,
      course: check.course,
      courseUrl: check.courseUrl,
    };
  }
  const fileName = TAXILA_HANDOUT_FILE;

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
      contextid: check.item.contextid,
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
              item: TAXILA_HANDOUT_ITEM,
              contextid: check.item.contextid,
              fileName,
              size: pdf.length,
              courseSource: view.choice ? 'chosen' : 'matched',
              replaced: check.replaces,
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
    message: `Published to Taxila: “${fileName}” in ${TAXILA_HANDOUT_ITEM}.`,
    fileName,
    course: check.course,
    courseUrl: check.courseUrl,
  };
}

export function taxilaClient(cfg: TaxilaConfig): TaxilaClient {
  return createTaxilaClient(cfg);
}

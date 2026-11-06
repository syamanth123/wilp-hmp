'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma, RoleName } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { transition } from '@hmp/workflow';
import { notifyTransition } from '@/lib/notifications';
import { createRequestWithRefNo, RefNoRetryExhausted } from './ref-no';
import { formError } from '@/lib/form-error';
import { setUpOfferingFromDibba } from '@/lib/dibba-offering';

const schema = z.object({
  courseOfferingId: z.string().cuid(),
  notes: z.string().max(2000).optional().default(''),
  previousHandoutUrl: z.string().url().optional().or(z.literal('')),
  hogId: z.string().min(1, 'Pick the Head of Group who will allocate it.'),
  hogReason: z.string().max(500).optional().default(''),
});

export async function createRequestAction(formData: FormData) {
  const actor = requireRole(await getSessionUser(), RoleName.INSTRUCTION_CELL);
  const parsed = schema.safeParse({
    courseOfferingId: formData.get('courseOfferingId'),
    notes: formData.get('notes') ?? '',
    previousHandoutUrl: formData.get('previousHandoutUrl') ?? '',
    hogId: formData.get('hogId') ?? '',
    hogReason: formData.get('hogReason') ?? '',
  });
  if (!parsed.success) {
    return { error: formError(parsed.error) };
  }

  const offering = await prisma.courseOffering.findUnique({
    where: { id: parsed.data.courseOfferingId },
    include: { semester: { include: { programme: { select: { departmentId: true } } } } },
  });
  if (!offering)
    return { error: 'That course offering no longer exists. Refresh the page and choose again.' };

  // v1.4 §C: the chosen HOG must be an active HOG; one outside the course's department needs a reason.
  const hog = await prisma.user.findFirst({
    where: {
      id: parsed.data.hogId,
      active: true,
      roles: { some: { role: { name: RoleName.HOG } } },
    },
    select: { id: true, departmentId: true },
  });
  if (!hog)
    return {
      error: 'That Head of Group is no longer available. Refresh the page and choose again.',
    };
  const courseDept = offering.semester.programme.departmentId;
  const deptHog = courseDept
    ? await prisma.user.findFirst({
        where: {
          departmentId: courseDept,
          active: true,
          roles: { some: { role: { name: RoleName.HOG } } },
        },
        select: { id: true },
      })
    : null;
  // H13: a HOG other than the department's — or any HOG when the department has none yet — needs a reason.
  const outside = deptHog ? deptHog.id !== hog.id : !!courseDept && hog.departmentId !== courseDept;
  const hogReason = parsed.data.hogReason.trim();
  if (outside && hogReason.length < 5)
    return { error: 'Say why it goes to a HOG outside the course’s department.' };

  let created: { id: string; refNo: string };
  try {
    created = await prisma.$transaction(async (tx) => {
      const req = await createRequestWithRefNo(
        {
          courseOfferingId: offering.id,
          initiatedById: actor.id,
          notes: parsed.data.notes || null,
          previousHandoutUrl: parsed.data.previousHandoutUrl || null,
        },
        tx,
      );
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'request.create',
          entity: 'HandoutRequest',
          entityId: req.id,
          after: { refNo: req.refNo, courseOfferingId: offering.id, hogId: hog.id } as never,
          requestId: req.id,
        },
      });
      await tx.requestAssignee.create({
        data: {
          requestId: req.id,
          role: RoleName.HOG,
          userId: hog.id,
          assignedById: actor.id,
          reason: outside ? hogReason : null,
        },
      });
      return req;
    });
  } catch (err) {
    if (err instanceof RefNoRetryExhausted) {
      console.error('[createRequest] refNo exhaustion', err);
      return { error: 'Could not create request right now — please retry.' };
    }
    throw err;
  }

  await transition({
    requestId: created.id,
    event: 'REQUEST_INITIATED',
    actor: { id: actor.id, roles: actor.roles },
  });

  await notifyTransition({
    requestId: created.id,
    event: 'REQUEST_INITIATED',
    actor: { id: actor.id, name: actor.name },
  });

  revalidatePath('/ic/requests');
  redirect(`/ic/requests/${created.id}`);
}

const setUpSchema = z.object({
  courses: z
    .string()
    .min(1)
    .max(200)
    .transform((s) =>
      s
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean),
    ),
  term: z.string().regex(/^\d{4}-(FIRST|SECOND|SUMMER)$/),
  semesterId: z.string().cuid(),
});

/**
 * "Create request" from a not-started Course Dibba row with no course offering yet: adds the
 * course (if needed) and the offering in the programme's existing semester, then reopens New
 * request filled in. IC / Admin only; create-only; audit-logged (lib/dibba-offering.ts).
 */
export async function setUpOfferingAction(formData: FormData) {
  const actor = requireRole(await getSessionUser(), RoleName.INSTRUCTION_CELL);
  const parsed = setUpSchema.safeParse({
    courses: formData.get('courses'),
    term: formData.get('term'),
    semesterId: formData.get('semesterId'),
  });
  if (!parsed.success) return { error: 'Pick a programme, then confirm.' };
  const [year, term] = parsed.data.term.split('-');
  const r = await setUpOfferingFromDibba(actor.id, {
    codes: parsed.data.courses,
    year: Number(year),
    term: term!,
    semesterId: parsed.data.semesterId,
  });
  if (!r.ok) return { error: r.error };
  revalidatePath('/handouts');
  const q = new URLSearchParams({
    courses: parsed.data.courses.join(','),
    term: parsed.data.term,
    offering: r.offeringId,
    added: r.createdOffering ? '1' : '0',
  });
  redirect(`/ic/requests/new?${q}`);
}

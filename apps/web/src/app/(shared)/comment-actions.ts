'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma, RoleName, HandoutStatus } from '@hmp/db';
import { getSessionUser } from '@hmp/auth';
import { audit } from '@/lib/audit';
import { notifyComment } from '@/lib/notifications';

const schema = z.object({
  requestId: z.string().cuid(),
  body: z.string().min(1, 'Comment cannot be empty').max(4000),
});

const ALLOWED_ROLES: ReadonlySet<RoleName> = new Set([
  RoleName.ADMIN,
  RoleName.INSTRUCTION_CELL,
  RoleName.HOG,
  RoleName.PROGRAMME_COMMITTEE,
  RoleName.FACULTY,
]);

export async function addCommentAction(formData: FormData) {
  const me = await getSessionUser();
  if (!me) return { error: 'Not authenticated' };
  if (!me.roles.some((r) => ALLOWED_ROLES.has(r))) return { error: 'Forbidden' };

  const parsed = schema.safeParse({
    requestId: formData.get('requestId'),
    body: formData.get('body'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' };

  const request = await prisma.handoutRequest.findUnique({
    where: { id: parsed.data.requestId },
    include: { handout: { select: { id: true } } },
  });
  if (!request) return { error: 'Request not found' };
  if (!request.handout) return { error: 'No handout yet — comments unlock after allocation.' };

  // Lock the thread once the workflow is closed.
  if (
    request.status === HandoutStatus.PUBLISHED ||
    request.status === HandoutStatus.ARCHIVED ||
    request.status === HandoutStatus.REJECTED
  ) {
    return { error: 'Comments are closed for this request.' };
  }

  // Faculty-only users must be assigned to this specific request.
  const hasNonFacultyRole = me.roles.some(
    (r) =>
      r === RoleName.ADMIN ||
      r === RoleName.INSTRUCTION_CELL ||
      r === RoleName.HOG ||
      r === RoleName.PROGRAMME_COMMITTEE,
  );
  if (!hasNonFacultyRole && me.roles.includes(RoleName.FACULTY)) {
    const assigned = await prisma.facultyAssignment.findFirst({
      where: { requestId: request.id, facultyId: me.id, active: true },
      select: { id: true },
    });
    if (!assigned) return { error: 'Forbidden' };
  }

  const comment = await prisma.comment.create({
    data: {
      handoutId: request.handout.id,
      authorId: me.id,
      body: parsed.data.body.trim(),
    },
  });

  await audit({
    actorId: me.id,
    action: 'comment.added',
    entity: 'Comment',
    entityId: comment.id,
    after: { handoutId: request.handout.id, length: parsed.data.body.length },
    requestId: request.id,
  });

  await notifyComment({
    requestId: request.id,
    commentId: comment.id,
    actor: { id: me.id, name: me.name },
  });

  revalidatePath(`/ic/requests/${request.id}`);
  revalidatePath(`/hog/requests/${request.id}`);
  revalidatePath(`/pc/requests/${request.id}`);
  revalidatePath(`/faculty/assignments/${request.id}`);
  return { ok: true };
}

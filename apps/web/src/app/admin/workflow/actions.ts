'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma, RoleName } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { audit } from '@/lib/audit';

const schema = z.object({
  hogReviewSla: z.coerce.number().int().min(1).max(720),
  pcReviewSla: z.coerce.number().int().min(1).max(720),
  facultySubmitSla: z.coerce.number().int().min(1).max(720),
  hogFinalSla: z.coerce.number().int().min(1).max(720),
  offCampusMaxCourses: z.coerce.number().int().min(1).max(10),
});

export async function updateWorkflowAction(formData: FormData) {
  const actor = requireRole(await getSessionUser(), RoleName.ADMIN);
  const parsed = schema.safeParse({
    hogReviewSla: formData.get('hogReviewSla'),
    pcReviewSla: formData.get('pcReviewSla'),
    facultySubmitSla: formData.get('facultySubmitSla'),
    hogFinalSla: formData.get('hogFinalSla'),
    offCampusMaxCourses: formData.get('offCampusMaxCourses'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const before = await prisma.workflowConfig.findUniqueOrThrow({ where: { key: 'default' } });
  const updated = await prisma.workflowConfig.update({
    where: { key: 'default' },
    data: parsed.data,
  });
  await audit({
    actorId: actor.id,
    action: 'workflow.update',
    entity: 'WorkflowConfig',
    entityId: updated.id,
    before: {
      hogReviewSla: before.hogReviewSla,
      pcReviewSla: before.pcReviewSla,
      facultySubmitSla: before.facultySubmitSla,
      hogFinalSla: before.hogFinalSla,
      offCampusMaxCourses: before.offCampusMaxCourses,
    },
    after: parsed.data,
  });
  revalidatePath('/admin/workflow');
  return { ok: true };
}

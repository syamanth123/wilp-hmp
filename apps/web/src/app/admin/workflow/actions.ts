'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma, RoleName } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { audit } from '@/lib/audit';
import { formError } from '@/lib/form-error';

const schema = z.object({
  hogReviewSla: z.coerce.number().int().min(1).max(720),
  pcReviewSla: z.coerce.number().int().min(1).max(720),
  facultySubmitSla: z.coerce.number().int().min(1).max(720),
  hogFinalSla: z.coerce.number().int().min(1).max(720),
  offCampusMaxCourses: z.coerce.number().int().min(1).max(10),
  // v1.4.2: SME review SLA, and due dates in days before the semester starts.
  smeReviewSla: z.coerce.number().int().min(1).max(720),
  dueAllocationDays: z.coerce.number().int().min(0).max(180),
  dueDraftDays: z.coerce.number().int().min(0).max(180),
  dueSmeDays: z.coerce.number().int().min(0).max(180),
  duePcDays: z.coerce.number().int().min(0).max(180),
  dueHogFinalDays: z.coerce.number().int().min(0).max(180),
  duePublishDays: z.coerce.number().int().min(-60).max(180),
});

const FIELDS = [
  'hogReviewSla',
  'pcReviewSla',
  'facultySubmitSla',
  'hogFinalSla',
  'offCampusMaxCourses',
  'smeReviewSla',
  'dueAllocationDays',
  'dueDraftDays',
  'dueSmeDays',
  'duePcDays',
  'dueHogFinalDays',
  'duePublishDays',
] as const;

export async function updateWorkflowAction(formData: FormData) {
  const actor = requireRole(await getSessionUser(), RoleName.ADMIN);
  const parsed = schema.safeParse(Object.fromEntries(FIELDS.map((f) => [f, formData.get(f)])));
  if (!parsed.success)
    return {
      error: formError(parsed.error, {
        hogReviewSla: 'HOG review — time allowed (hours)',
        pcReviewSla: 'PC review — time allowed (hours)',
        facultySubmitSla: 'Faculty writing — time allowed (hours)',
        hogFinalSla: 'HOG final approval — time allowed (hours)',
        offCampusMaxCourses: 'Courses per off-campus faculty member',
        smeReviewSla: 'SME review — time allowed (hours)',
        dueAllocationDays: 'Allocation due (days before the semester starts)',
        dueDraftDays: 'Faculty draft due (days before)',
        dueSmeDays: 'SME review due (days before)',
        duePcDays: 'PC review due (days before)',
        dueHogFinalDays: 'HOG final approval due (days before)',
        duePublishDays: 'Publish due (days before)',
      }),
    };
  const d = parsed.data;
  if (
    !(
      d.dueAllocationDays >= d.dueDraftDays &&
      d.dueDraftDays >= d.dueSmeDays &&
      d.dueSmeDays >= d.duePcDays &&
      d.duePcDays >= d.dueHogFinalDays &&
      d.dueHogFinalDays >= d.duePublishDays
    )
  )
    return {
      error:
        'The due dates must come in order: allocation first, publish last (each number no larger than the one before).',
    };
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
    before: Object.fromEntries(FIELDS.map((f) => [f, before[f]])),
    after: parsed.data,
  });
  revalidatePath('/admin/workflow');
  return { ok: true };
}

const switchesSchema = z.object({
  escalationOn: z.boolean(),
  escalationDays: z.coerce.number().int().min(1).max(30),
  autoPublish: z.boolean(),
});

/** v1.4.2 — escalation (H26: starts off) and auto-publish (H23: off by default). Admin only here. */
export async function updateSwitchesAction(formData: FormData) {
  const actor = requireRole(await getSessionUser(), RoleName.ADMIN);
  const parsed = switchesSchema.safeParse({
    escalationOn: formData.get('escalationOn') === 'on',
    escalationDays: formData.get('escalationDays'),
    autoPublish: formData.get('autoPublish') === 'on',
  });
  if (!parsed.success) return { error: 'Escalation after: a whole number of days, 1 to 30.' };
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
      escalationOn: before.escalationOn,
      escalationDays: before.escalationDays,
      autoPublish: before.autoPublish,
    },
    after: parsed.data,
  });
  revalidatePath('/admin/workflow');
  return { ok: true };
}

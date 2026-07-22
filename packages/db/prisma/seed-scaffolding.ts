import type { PrismaClient} from '@prisma/client';
import { RoleName, NotificationChannel } from '@prisma/client';
import {
  SME_APPROVAL_TEMPLATES,
  PUBLISH_NOTIFICATION_TEMPLATES,
} from '../src/notification-templates';

/**
 * Environment-agnostic scaffolding shared by BOTH the dev seed (seed.ts) and the
 * production seed (seed.production.ts): RBAC roles + permissions, notification
 * templates, and workflow config. Seeding this from ONE place means the dev and
 * prod RBAC matrices can't drift — the same discipline that keeps the renderer
 * allowlist and notification-template strings in shared constants.
 *
 * Everything here is idempotent (upserts), so re-running is a no-op. It creates
 * NO users and NO demo/academic data — those are dev-only (seed.ts) or
 * env-driven (seed.production.ts).
 */

export const PERMISSIONS: Array<{ key: string; label: string; roles: RoleName[] }> = [
  // user mgmt
  { key: 'user.read', label: 'View users', roles: [RoleName.ADMIN] },
  { key: 'user.create', label: 'Create users', roles: [RoleName.ADMIN] },
  { key: 'user.update', label: 'Update users', roles: [RoleName.ADMIN] },
  { key: 'user.deactivate', label: 'Deactivate users', roles: [RoleName.ADMIN] },
  // academic
  {
    key: 'academic.read',
    label: 'View academic structure',
    roles: [
      RoleName.ADMIN,
      RoleName.INSTRUCTION_CELL,
      RoleName.HOG,
      RoleName.PROGRAMME_COMMITTEE,
      RoleName.FACULTY,
    ],
  },
  { key: 'academic.manage', label: 'Manage academic structure', roles: [RoleName.ADMIN] },
  // workflow config
  { key: 'workflow.config', label: 'Configure workflow', roles: [RoleName.ADMIN] },
  // handout request
  {
    key: 'request.initiate',
    label: 'Initiate handout request',
    roles: [RoleName.INSTRUCTION_CELL],
  },
  { key: 'request.allocate', label: 'Allocate faculty', roles: [RoleName.HOG] },
  {
    key: 'request.assign',
    label: 'Assign handout to faculty',
    roles: [RoleName.PROGRAMME_COMMITTEE],
  },
  { key: 'handout.edit', label: 'Edit handout', roles: [RoleName.FACULTY] },
  { key: 'handout.submit', label: 'Submit handout', roles: [RoleName.FACULTY] },
  {
    key: 'handout.review',
    label: 'Review handout',
    roles: [RoleName.PROGRAMME_COMMITTEE, RoleName.HOG],
  },
  { key: 'handout.approve', label: 'Approve handout', roles: [RoleName.HOG] },
  { key: 'handout.publish', label: 'Publish handout', roles: [RoleName.INSTRUCTION_CELL] },
  {
    key: 'handout.archive',
    label: 'Archive handout',
    roles: [RoleName.ADMIN, RoleName.INSTRUCTION_CELL],
  },
  // audit
  { key: 'audit.read', label: 'View audit logs', roles: [RoleName.ADMIN] },
  // ai
  {
    key: 'ai.use',
    label: 'Use AI features',
    roles: [RoleName.HOG, RoleName.PROGRAMME_COMMITTEE, RoleName.FACULTY],
  },
  // SME advisory flow (Prompt 5)
  {
    key: 'handout.read',
    label: 'View assigned handouts',
    roles: [
      RoleName.ADMIN,
      RoleName.INSTRUCTION_CELL,
      RoleName.HOG,
      RoleName.PROGRAMME_COMMITTEE,
      RoleName.FACULTY,
      RoleName.SME,
    ],
  },
  {
    key: 'comment.write',
    label: 'Add comments to a handout',
    roles: [
      RoleName.ADMIN,
      RoleName.INSTRUCTION_CELL,
      RoleName.HOG,
      RoleName.PROGRAMME_COMMITTEE,
      RoleName.FACULTY,
      RoleName.SME,
    ],
  },
  {
    key: 'handout.advise',
    label: 'View assigned handouts and add advisory comments',
    roles: [RoleName.ADMIN, RoleName.SME],
  },
];

/** Base workflow-event notification templates (the SME + publish sets are
 * imported from the shared constants module). */
export const BASE_NOTIFICATION_TEMPLATES: Array<{ key: string; subject: string; body: string }> = [
  {
    key: 'handout.requested',
    subject: 'New handout request {{refNo}}',
    body: 'A new handout request {{refNo}} has been initiated.',
  },
  {
    key: 'handout.allocated',
    subject: 'Faculty allocated for {{refNo}}',
    body: 'Faculty allocation completed for {{refNo}}.',
  },
  {
    key: 'handout.assigned',
    subject: 'You have been assigned {{refNo}}',
    body: 'Please log in to view and edit your assigned handout.',
  },
  {
    key: 'handout.allocation_rejected',
    subject: 'Allocation for {{refNo}} needs revision',
    body: 'The Programme Committee rejected the faculty/SME allocation for {{refNo}}. Please review the reason and re-allocate.',
  },
  {
    key: 'handout.submitted',
    subject: 'Handout {{refNo}} submitted',
    body: 'Handout {{refNo}} is now awaiting review.',
  },
  {
    key: 'handout.rework',
    subject: 'Rework requested on {{refNo}}',
    body: 'Please address the review comments and resubmit.',
  },
  {
    key: 'handout.review_approved',
    subject: 'Review approved for {{refNo}}',
    body: 'PC has approved {{refNo}} and forwarded to HOG.',
  },
  {
    key: 'handout.approved',
    subject: 'Handout {{refNo}} approved',
    body: 'Handout {{refNo}} has been approved.',
  },
  {
    key: 'handout.rejected',
    subject: 'Handout {{refNo}} rejected',
    body: 'Handout {{refNo}} has been rejected.',
  },
  {
    key: 'handout.published',
    subject: 'Handout {{refNo}} published to LMS',
    body: 'Handout {{refNo}} has been published to Taxila.',
  },
];

export const WORKFLOW_CONFIG_MATRIX = {
  stages: ['HOG_REVIEW', 'PC_REVIEW', 'HOG_FINAL', 'IC_PUBLISH'],
  rework: { allowedFrom: ['PC_REVIEW', 'HOG_FINAL'] },
};

/** Hard stop: the dev seed must never run against a production database. */
export function assertDevOnly(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'seed.ts is dev-only (it creates demo users with a default password). ' +
        'In production use seed.production.ts (pnpm --filter @hmp/db db:seed:prod). ' +
        'If this is genuinely non-production, set NODE_ENV explicitly.',
    );
  }
}

/** Seed roles, permissions + role bindings, notification templates, and the
 * default workflow config. Idempotent. Shared by dev + prod seeds. */
export async function seedScaffolding(prisma: PrismaClient): Promise<void> {
  // Roles
  const roleRecords = await Promise.all(
    Object.values(RoleName).map((name) =>
      prisma.role.upsert({
        where: { name },
        update: {},
        create: { name, description: name.replace(/_/g, ' ') },
      }),
    ),
  );
  const roleMap = new Map(roleRecords.map((r) => [r.name, r]));

  // Permissions + role bindings
  for (const p of PERMISSIONS) {
    const perm = await prisma.permission.upsert({
      where: { key: p.key },
      update: { label: p.label },
      create: { key: p.key, label: p.label },
    });
    for (const roleName of p.roles) {
      const role = roleMap.get(roleName)!;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
        update: {},
        create: { roleId: role.id, permissionId: perm.id },
      });
    }
  }

  // Notification templates (base + SME + publish)
  const templates = [
    ...BASE_NOTIFICATION_TEMPLATES,
    ...SME_APPROVAL_TEMPLATES.map((t) => ({ key: t.key, subject: t.subject, body: t.body })),
    ...PUBLISH_NOTIFICATION_TEMPLATES.map((t) => ({
      key: t.key,
      subject: t.subject,
      body: t.body,
    })),
  ];
  for (const t of templates) {
    await prisma.notificationTemplate.upsert({
      where: { key: t.key },
      update: { subject: t.subject, body: t.body },
      create: { ...t, channels: [NotificationChannel.IN_PORTAL, NotificationChannel.EMAIL] },
    });
  }

  // Workflow config
  await prisma.workflowConfig.upsert({
    where: { key: 'default' },
    update: {},
    create: { key: 'default', matrixJson: WORKFLOW_CONFIG_MATRIX },
  });
}

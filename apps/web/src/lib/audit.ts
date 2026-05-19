import { prisma } from '@hmp/db';

export async function audit(input: {
  actorId?: string | null;
  action: string;
  entity: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  requestId?: string;
  ip?: string;
  userAgent?: string;
}) {
  await prisma.auditLog.create({
    data: {
      actorId: input.actorId ?? null,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      before: (input.before as never) ?? null,
      after: (input.after as never) ?? null,
      requestId: input.requestId,
      ip: input.ip,
      userAgent: input.userAgent,
    },
  });
}

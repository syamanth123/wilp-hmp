import { prisma, HandoutStatus, RoleName, type Prisma } from '@hmp/db';

/**
 * v1.4.1 (H4 / H11): existing requests get their department's HOG — a preview, then Apply, run by the
 * IC / Admin once departments are filled in (Departments page). Never replaces a HOG already recorded;
 * can be run again after fixing what it lists. Requests still without one stay visible to their
 * department's HOGs (or to all HOGs when the department isn't known), so nothing disappears meanwhile.
 */

const DONE: HandoutStatus[] = [
  HandoutStatus.PUBLISHED,
  HandoutStatus.ARCHIVED,
  HandoutStatus.REJECTED,
];

export type SkipReason = 'department-unknown' | 'no-hog';

export interface BackfillPreview {
  assign: {
    requestId: string;
    refNo: string;
    course: string;
    hogId: string;
    hogName: string;
    department: string;
  }[];
  skipped: {
    requestId: string;
    refNo: string;
    course: string;
    reason: SkipReason;
    programmeCode: string;
    departmentId: string | null;
    department: string | null;
  }[];
}

/** `onlyRequestIds`: limit to these requests (tests). */
export async function previewHogBackfill(onlyRequestIds?: string[]): Promise<BackfillPreview> {
  const [requests, hogs] = await Promise.all([
    prisma.handoutRequest.findMany({
      where: {
        status: { notIn: DONE },
        ...(onlyRequestIds ? { id: { in: onlyRequestIds } } : {}),
        assignees: { none: { role: RoleName.HOG, endedAt: null } },
      },
      orderBy: { refNo: 'asc' },
      select: {
        id: true,
        refNo: true,
        offering: {
          select: {
            course: { select: { code: true, title: true } },
            semester: {
              select: {
                programme: {
                  select: {
                    code: true,
                    departmentId: true,
                    department: { select: { name: true } },
                  },
                },
              },
            },
          },
        },
      },
    }),
    prisma.user.findMany({
      where: {
        active: true,
        departmentId: { not: null },
        roles: { some: { role: { name: RoleName.HOG } } },
      },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, departmentId: true },
    }),
  ]);
  const hogOf = new Map<string, { id: string; name: string }>();
  for (const h of hogs) if (!hogOf.has(h.departmentId!)) hogOf.set(h.departmentId!, h);

  const out: BackfillPreview = { assign: [], skipped: [] };
  for (const r of requests) {
    const p = r.offering.semester.programme;
    const course = `${r.offering.course.code} ${r.offering.course.title}`;
    const base = { requestId: r.id, refNo: r.refNo, course };
    if (!p.departmentId) {
      out.skipped.push({
        ...base,
        reason: 'department-unknown',
        programmeCode: p.code,
        departmentId: null,
        department: null,
      });
      continue;
    }
    const hog = hogOf.get(p.departmentId);
    if (!hog) {
      out.skipped.push({
        ...base,
        reason: 'no-hog',
        programmeCode: p.code,
        departmentId: p.departmentId,
        department: p.department?.name ?? null,
      });
      continue;
    }
    out.assign.push({
      ...base,
      hogId: hog.id,
      hogName: hog.name,
      department: p.department?.name ?? '',
    });
  }
  return out;
}

/** Writes the HOG rows the preview shows (worked out again now, so it is never stale). */
export async function applyHogBackfill(
  actorId: string,
  onlyRequestIds?: string[],
): Promise<{ assigned: number; skipped: number }> {
  const preview = await previewHogBackfill(onlyRequestIds);
  await prisma.$transaction(async (tx) => {
    for (const a of preview.assign) {
      // Re-check inside the transaction: someone may have set a HOG since.
      const has = await tx.requestAssignee.count({
        where: { requestId: a.requestId, role: RoleName.HOG, endedAt: null },
      });
      if (has) continue;
      await tx.requestAssignee.create({
        data: {
          requestId: a.requestId,
          role: RoleName.HOG,
          userId: a.hogId,
          assignedById: actorId,
          reason: 'v1.4.1, department HOG',
        },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'request.assign-hog',
          entity: 'HandoutRequest',
          entityId: a.requestId,
          requestId: a.requestId,
          after: {
            hogId: a.hogId,
            department: a.department,
            source: 'v1.4.1 backfill',
          } as Prisma.InputJsonValue,
        },
      });
    }
  });
  return { assigned: preview.assign.length, skipped: preview.skipped.length };
}

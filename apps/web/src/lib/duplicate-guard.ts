import { prisma, HandoutStatus } from '@hmp/db';

/**
 * v1.4.2 (F5) — one request per course offering: the same rule as bulk upload (bulk-create.ts). A request
 * that is anything but Rejected or Archived blocks a new one for the same course and semester.
 */
export const DUPLICATE_EXCLUDES: HandoutStatus[] = [HandoutStatus.REJECTED, HandoutStatus.ARCHIVED];

export interface ExistingRequest {
  id: string;
  refNo: string;
  status: HandoutStatus;
}

export async function existingRequests(
  offeringIds: string[],
): Promise<Map<string, ExistingRequest>> {
  if (offeringIds.length === 0) return new Map();
  const rows = await prisma.handoutRequest.findMany({
    where: { courseOfferingId: { in: offeringIds }, status: { notIn: DUPLICATE_EXCLUDES } },
    select: { id: true, refNo: true, status: true, courseOfferingId: true },
    orderBy: { createdAt: 'desc' },
  });
  const out = new Map<string, ExistingRequest>();
  for (const r of rows) if (!out.has(r.courseOfferingId)) out.set(r.courseOfferingId, r);
  return out;
}

export function duplicateMessage(e: ExistingRequest, course: string, semester: string): string {
  return `${e.refNo} already exists for ${course}, ${semester} — open it instead.`;
}

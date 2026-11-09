import { prisma, RoleName } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import {
  ScheduleOverview,
  type ScheduleOverviewSearchParams,
} from '@/components/schedule-overview';

export const dynamic = 'force-dynamic';

/** /pc/schedule — term overview for the Programme Committee (Course Dibba Phase 6). */
export default async function PcSchedulePage({
  searchParams,
}: {
  searchParams: ScheduleOverviewSearchParams;
}) {
  const me = requireRole(await getSessionUser(), RoleName.PROGRAMME_COMMITTEE);
  // v1.4.1 (H14): their department by default, with an "All departments" switch.
  const department = me.departmentId
    ? await prisma.department.findUnique({
        where: { id: me.departmentId },
        select: { id: true, name: true },
      })
    : null;
  return (
    <ScheduleOverview basePath="/pc/schedule" searchParams={searchParams} department={department} />
  );
}

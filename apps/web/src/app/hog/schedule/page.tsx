import { prisma, RoleName } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import {
  ScheduleOverview,
  type ScheduleOverviewSearchParams,
} from '@/components/schedule-overview';

export const dynamic = 'force-dynamic';

/** /hog/schedule — term overview for the Head of Group (Course Dibba Phase 6). */
export default async function HogSchedulePage({
  searchParams,
}: {
  searchParams: ScheduleOverviewSearchParams;
}) {
  const me = requireRole(await getSessionUser(), RoleName.HOG);
  // v1.4.1 (H14): their department by default, with an "All departments" switch.
  const department = me.departmentId
    ? await prisma.department.findUnique({
        where: { id: me.departmentId },
        select: { id: true, name: true },
      })
    : null;
  return (
    <ScheduleOverview
      basePath="/hog/schedule"
      searchParams={searchParams}
      department={department}
    />
  );
}

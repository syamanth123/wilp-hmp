import { RoleName } from '@hmp/db';
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
  requireRole(await getSessionUser(), RoleName.HOG);
  return <ScheduleOverview basePath="/hog/schedule" searchParams={searchParams} />;
}

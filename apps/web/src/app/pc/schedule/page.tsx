import { RoleName } from '@hmp/db';
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
  requireRole(await getSessionUser(), RoleName.PROGRAMME_COMMITTEE);
  return <ScheduleOverview basePath="/pc/schedule" searchParams={searchParams} />;
}

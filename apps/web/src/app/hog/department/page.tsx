import { DepartmentDashboardView } from '@/components/department-dashboard-view';

export const dynamic = 'force-dynamic';

/** Head of Group → My department (v1.4.2). */
export default function HogDepartmentDashboardPage({
  searchParams,
}: {
  searchParams: { term?: string };
}) {
  return <DepartmentDashboardView own searchParams={searchParams} path="/hog/department" />;
}

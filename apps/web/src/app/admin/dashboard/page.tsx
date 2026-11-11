import { DepartmentDashboardView } from '@/components/department-dashboard-view';

export const dynamic = 'force-dynamic';

/** Admin → Department dashboard (v1.4.2). */
export default function AdminDepartmentDashboardPage({
  searchParams,
}: {
  searchParams: { term?: string };
}) {
  return <DepartmentDashboardView searchParams={searchParams} path="/admin/dashboard" />;
}

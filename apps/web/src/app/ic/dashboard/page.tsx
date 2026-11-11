import { DepartmentDashboardView } from '@/components/department-dashboard-view';

export const dynamic = 'force-dynamic';

/** Instruction Cell → Department dashboard (v1.4.2). */
export default function IcDepartmentDashboardPage({
  searchParams,
}: {
  searchParams: { term?: string };
}) {
  return <DepartmentDashboardView searchParams={searchParams} path="/ic/dashboard" />;
}

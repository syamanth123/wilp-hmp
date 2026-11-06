import { DepartmentsView } from '@/app/admin/departments/departments-view';

export const dynamic = 'force-dynamic';

/** Instruction Cell → Departments (v1.4.0). */
export default function IcDepartmentsPage() {
  return <DepartmentsView base="/ic" />;
}

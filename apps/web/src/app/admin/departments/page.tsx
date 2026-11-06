import { DepartmentsView } from './departments-view';

export const dynamic = 'force-dynamic';

/** Admin → Departments (v1.4.0). The same page is the Instruction Cell's under /ic/departments. */
export default function DepartmentsPage() {
  return <DepartmentsView base="/admin" />;
}

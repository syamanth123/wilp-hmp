import { getSessionUser } from '@hmp/auth';
import { seesAllForMissingDepartment } from '@/lib/department-scope';

/**
 * v1.4.1 (H9): a HOG / PC whose department isn't set sees every department's handouts — and is told
 * so, until the IC / Admin sets it (People).
 */
export async function DepartmentNotice() {
  const me = await getSessionUser();
  if (!me || !seesAllForMissingDepartment(me)) return null;
  return (
    <p
      className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950"
      role="status"
      data-testid="department-notice"
    >
      Your department isn&apos;t set — you see all departments. The Instruction Cell sets it in
      People; then you see your own department&apos;s handouts.
    </p>
  );
}

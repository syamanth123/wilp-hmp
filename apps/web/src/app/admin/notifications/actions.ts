'use server';

import { RoleName } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { scanActiveRequestsWithSla } from '@/lib/sla';
import { notifySlaReminder } from '@/lib/notifications';

export async function runSweepAction(): Promise<
  { scanned: number; dueSoon: number; overdue: number; notified: number } | { error: string }
> {
  try {
    requireRole(await getSessionUser(), RoleName.ADMIN);
  } catch {
    return { error: 'Forbidden' };
  }

  const rows = await scanActiveRequestsWithSla();
  let dueSoon = 0;
  let overdue = 0;
  let notified = 0;
  for (const r of rows) {
    if (r.sla.classification !== 'due_soon' && r.sla.classification !== 'overdue') continue;
    if (r.sla.classification === 'due_soon') dueSoon += 1;
    else overdue += 1;
    if (r.sla.slaHours == null) continue;
    notified += await notifySlaReminder({
      request: { id: r.id, refNo: r.refNo, status: r.status },
      classification: r.sla.classification,
      ageHours: r.sla.ageHours,
      slaHours: r.sla.slaHours,
    });
  }
  return { scanned: rows.length, dueSoon, overdue, notified };
}

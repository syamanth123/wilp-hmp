'use server';

import { RoleName } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { runDailyNow, type RunSummary } from '@/lib/daily-run';
import { emailsSettled } from '@/lib/notifications';

/** v1.4.2: Run now — the daily run (reminders, escalation, digests), now. Each step is still sent once. */
export async function runSweepAction(): Promise<RunSummary | { error: string }> {
  try {
    requireRole(await getSessionUser(), RoleName.ADMIN);
  } catch {
    return { error: "You don't have permission to do this." };
  }
  const summary = await runDailyNow();
  await emailsSettled();
  return summary;
}

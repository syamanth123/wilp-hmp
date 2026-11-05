'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { RoleName } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { taxilaClient, taxilaSettings } from '@/lib/taxila-publish';
import { createTaxilaRun, loadRun, processNextItem, retryProblemItems } from '@/lib/taxila-runs';

const SEMESTER_CODE = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9-]{2,12}$/, 'Type the Taxila semester code, e.g. S1-26.');

/** From the Handout Library: start a bulk run with the ticked approved handouts. IC / Admin. */
export async function createTaxilaRunAction(formData: FormData) {
  const actor = requireRole(await getSessionUser(), RoleName.INSTRUCTION_CELL);
  if (!taxilaSettings()) return { error: 'Publishing to Taxila isn’t set up on this server.' };
  const code = SEMESTER_CODE.safeParse(formData.get('semesterCode') ?? '');
  if (!code.success) return { error: code.error.issues[0]!.message };
  const ids = formData
    .getAll('requestId')
    .map(String)
    .filter((s) => /^c[a-z0-9]{20,}$/i.test(s));
  const r = await createTaxilaRun({ actorId: actor.id, semesterCode: code.data, requestIds: ids });
  if (!r.ok) return { error: r.error };
  redirect(`/ic/taxila-runs/${r.runId}`);
}

/** One course of the run ("check" uploads nothing). The browser calls this until done. */
export async function runStepAction(runId: string, mode: 'check' | 'publish') {
  const actor = requireRole(await getSessionUser(), RoleName.INSTRUCTION_CELL);
  const cfg = taxilaSettings();
  if (!cfg) return { error: 'Publishing to Taxila isn’t set up on this server.' } as const;
  if (mode !== 'check' && mode !== 'publish') return { error: 'Unknown step.' } as const;
  const step = await processNextItem(
    runId,
    mode,
    { id: actor.id, name: actor.name, roles: actor.roles },
    taxilaClient(cfg),
    cfg,
  );
  const run = await loadRun(runId);
  if (step.done) revalidatePath('/handouts');
  return {
    ok: true,
    done: step.done,
    rows: run?.rows ?? [],
    status: run?.status ?? 'DONE',
  } as const;
}

/** Put the problem courses back in the queue (e.g. after IC created the missing folders). */
export async function retryProblemsAction(runId: string) {
  requireRole(await getSessionUser(), RoleName.INSTRUCTION_CELL);
  const n = await retryProblemItems(runId);
  const run = await loadRun(runId);
  return { ok: true, reset: n, rows: run?.rows ?? [] } as const;
}

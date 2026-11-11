'use server';

import { revalidatePath } from 'next/cache';
import { prisma, RoleName } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { loadKickoff } from '@/lib/kickoff';
import { setUpOfferingFromDibba } from '@/lib/dibba-offering';
import { bulkCreateHandouts } from '../requests/bulk-upload/bulk-create';

export type KickoffResult =
  | { ok: true; created: number; refNos: string[]; notes: string[] }
  | { ok: false; error: string };

const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/**
 * v1.4.2 — create the ticked courses' requests. Re-plans on the server (the browser only says which rows),
 * adds any missing course offering from the Course Dibba, then creates the requests with the bulk-upload
 * engine: each goes to its department's HOG, all-or-nothing per that engine's rules.
 */
export async function kickoffCreateAction(term: string, keys: string[]): Promise<KickoffResult> {
  const actor = requireRole(await getSessionUser(), [RoleName.INSTRUCTION_CELL, RoleName.ADMIN]);
  if (!Array.isArray(keys) || keys.length === 0)
    return { ok: false, error: 'Tick at least one course.' };
  const k = await loadKickoff(actor, term);
  if (k.term !== term)
    return { ok: false, error: 'That semester has nothing left to start. Refresh the page.' };
  const wanted = new Set(keys.map(String));
  const rows = k.rows.filter((r) => wanted.has(r.key) && !r.problem && r.semesterId);
  if (rows.length === 0)
    return { ok: false, error: 'None of the ticked courses can be started now. Refresh the page.' };

  const [year, termWord] = term.split('-');
  const notes: string[] = [];
  const lines = ['programme_code,course_code,semester'];
  for (const r of rows) {
    const set = await setUpOfferingFromDibba(actor.id, {
      codes: r.codes,
      year: Number(year),
      term: termWord!,
      semesterId: r.semesterId!,
    });
    if (!set.ok) {
      notes.push(`${r.courseCode}: ${set.error}`);
      continue;
    }
    const o = await prisma.courseOffering.findUniqueOrThrow({
      where: { id: set.offeringId },
      select: {
        course: { select: { code: true } },
        semester: { select: { name: true, programme: { select: { code: true } } } },
      },
    });
    lines.push([o.semester.programme.code, o.course.code, o.semester.name].map(csvCell).join(','));
  }
  if (lines.length === 1) return { ok: false, error: notes.join(' ') || 'Nothing to create.' };
  const result = await bulkCreateHandouts(lines.join('\n'), {
    id: actor.id,
    roles: actor.roles,
    name: actor.name,
  });
  revalidatePath('/ic');
  revalidatePath('/ic/requests');
  revalidatePath('/ic/kick-off');
  if (result.status === 'rejected')
    return {
      ok: false,
      error: result.errors.map((e) => `Row ${e.line}: ${e.message}`).join(' · '),
    };
  if (result.status === 'partial')
    notes.push(...result.strandedAtDraft.map((s) => `${s.refNo}: ${s.reason}`));
  return { ok: true, created: result.created, refNos: result.refNos, notes };
}

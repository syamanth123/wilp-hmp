'use server';

import { revalidatePath } from 'next/cache';
import { RoleName } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import {
  applyDibbaCodeCsv,
  setDibbaCodeMapping,
  type CsvResult,
} from '@/lib/dibba-programme-codes';

/** Link one Course Dibba programme code to an HMP programme ('' = unlink). Admin only. */
export async function setDibbaCodeAction(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = requireRole(await getSessionUser(), RoleName.ADMIN);
  const code = String(formData.get('code') ?? '').trim();
  const programmeId = String(formData.get('programmeId') ?? '').trim() || null;
  if (!code) return { ok: false, error: 'Missing code.' };
  const r = await setDibbaCodeMapping(actor.id, code, programmeId);
  if (!r.ok) return r;
  revalidatePath('/admin/dibba-codes');
  return { ok: true };
}

/** CSV `code,programme_code` — every row checked first; one bad row saves nothing. Admin only. */
export async function uploadDibbaCodesAction(formData: FormData): Promise<CsvResult> {
  const actor = requireRole(await getSessionUser(), RoleName.ADMIN);
  const csv = String(formData.get('csv') ?? '');
  if (csv.length > 200_000)
    return { ok: false, errors: [{ line: 1, message: 'The file is too large (200 KB at most).' }] };
  const r = await applyDibbaCodeCsv(actor.id, csv);
  if (r.ok) revalidatePath('/admin/dibba-codes');
  return r;
}

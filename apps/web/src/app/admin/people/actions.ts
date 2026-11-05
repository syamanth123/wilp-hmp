'use server';

import { revalidatePath } from 'next/cache';
import ExcelJS from 'exceljs';
import { RoleName, FacultyType } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { savePerson, type PersonInput, type SaveResult } from '@/lib/people-save';
import { applyPeople, previewPeople, type Preview } from '@/lib/people-import';

/** Add or edit a person (Admin). Returns the impact list when replacements are needed first. */
export async function savePersonAction(input: PersonInput): Promise<SaveResult> {
  const actor = requireRole(await getSessionUser(), RoleName.ADMIN);
  const clean: PersonInput = {
    ...input,
    roles: input.roles.filter((r) => (Object.values(RoleName) as string[]).includes(r)),
    facultyType:
      input.facultyType && (Object.values(FacultyType) as string[]).includes(input.facultyType)
        ? input.facultyType
        : null,
    departmentId: input.departmentId || null,
  };
  const r = await savePerson(actor.id, clean);
  if (r.ok) revalidatePath('/admin/people');
  return r;
}

async function toCsv(fd: FormData): Promise<string> {
  const file = fd.get('file');
  if (file instanceof File && /\.xlsx$/i.test(file.name)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await file.arrayBuffer()) as never);
    const ws = wb.worksheets[0];
    const lines: string[] = [];
    ws?.eachRow((row) => {
      const cells = (row.values as unknown[]).slice(1).map((v) => {
        const s =
          v == null
            ? ''
            : typeof v === 'object' && 'text' in (v as object)
              ? String((v as { text: unknown }).text)
              : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      });
      lines.push(cells.join(','));
    });
    return lines.join('\n');
  }
  if (file instanceof File) return file.text();
  return String(fd.get('csv') ?? '');
}

/** Upload people: preview only — nothing is saved. */
export async function previewPeopleAction(fd: FormData): Promise<Preview> {
  requireRole(await getSessionUser(), RoleName.ADMIN);
  return previewPeople(await toCsv(fd));
}

/** Upload people: save every row (or none if any row has an error). */
export async function applyPeopleAction(fd: FormData) {
  const actor = requireRole(await getSessionUser(), RoleName.ADMIN);
  const r = await applyPeople(actor.id, await toCsv(fd));
  if (r.ok) revalidatePath('/admin/people');
  return r;
}

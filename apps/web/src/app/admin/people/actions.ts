'use server';

import { revalidatePath } from 'next/cache';
import ExcelJS from 'exceljs';
import { prisma, RoleName, FacultyType } from '@hmp/db';
import { savePerson, type PersonInput, type SaveResult } from '@/lib/people-save';
import { applyPeople, previewPeople, type Preview } from '@/lib/people-import';
import { PEOPLE_PATHS, adminOnlyProblem, requirePeopleManager } from '@/lib/people-access';

const refresh = () => PEOPLE_PATHS.forEach((p) => revalidatePath(p));

/**
 * Add or edit a person (Admin, or the Instruction Cell — who can't change an Admin account or give
 * the Admin role). Returns the impact list when replacements are needed first.
 */
export async function savePersonAction(input: PersonInput): Promise<SaveResult> {
  const actor = await requirePeopleManager();
  const clean: PersonInput = {
    ...input,
    roles: input.roles.filter((r) => (Object.values(RoleName) as string[]).includes(r)),
    facultyType:
      input.facultyType && (Object.values(FacultyType) as string[]).includes(input.facultyType)
        ? input.facultyType
        : null,
    departmentId: input.departmentId || null,
  };
  const before = clean.id
    ? (
        await prisma.userRole.findMany({
          where: { userId: clean.id },
          select: { role: { select: { name: true } } },
        })
      ).map((r) => r.role.name)
    : null;
  const notYours = adminOnlyProblem(actor.isAdmin, before, clean.roles);
  if (notYours) return { ok: false, error: notYours };
  const r = await savePerson(actor.id, clean);
  if (r.ok) refresh();
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
  const actor = await requirePeopleManager();
  return previewPeople(await toCsv(fd), { actorIsAdmin: actor.isAdmin });
}

/**
 * Upload people: save every row (or none if any row has an error). `accept` lists the file lines
 * whose suggested department was ticked; no other suggestion is saved.
 */
export async function applyPeopleAction(fd: FormData) {
  const actor = await requirePeopleManager();
  let accept: number[] = [];
  try {
    const raw: unknown = JSON.parse(String(fd.get('accept') ?? '[]'));
    if (Array.isArray(raw))
      accept = raw.filter((n): n is number => Number.isInteger(n)).slice(0, 5000);
  } catch {
    accept = [];
  }
  const r = await applyPeople(actor.id, await toCsv(fd), accept, { actorIsAdmin: actor.isAdmin });
  if (r.ok) refresh();
  return r;
}

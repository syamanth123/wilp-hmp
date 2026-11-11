'use server';

import { revalidatePath } from 'next/cache';
import ExcelJS from 'exceljs';
import { prisma, RoleName, FacultyType } from '@hmp/db';
import { savePerson, type PersonInput, type SaveResult } from '@/lib/people-save';
import { applyPeople, previewPeople, type Preview } from '@/lib/people-import';
import { PEOPLE_PATHS, adminOnlyProblem, requirePeopleManager } from '@/lib/people-access';
import { undoPersonChange } from '@/lib/people-undo';
import { endAway, saveAway } from '@/lib/away-save';

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

/** v1.4.2 — undo a person's latest role / department change within 24 hours (lib/people-undo.ts). */
export async function undoPersonChangeAction(userId: string, auditId: string) {
  const actor = await requirePeopleManager();
  const r = await undoPersonChange(actor, String(userId), String(auditId));
  if (r.ok) refresh();
  return r;
}

/** v1.4.2 (§4): the IC / Admin marks someone away (e.g. sudden leave), with their back-up. */
export async function setAwayForAction(personId: string, _prev: unknown, fd: FormData) {
  const actor = await requirePeopleManager();
  const person = await prisma.user.findUnique({
    where: { id: String(personId) },
    select: { id: true, name: true, roles: { select: { role: { select: { name: true } } } } },
  });
  if (!person) return { ok: false as const, error: 'That person no longer exists.' };
  const roles = person.roles.map((r) => r.role.name);
  const notYours = adminOnlyProblem(actor.isAdmin, roles, roles);
  if (notYours) return { ok: false as const, error: notYours };
  const r = await saveAway({
    person: { id: person.id, name: person.name, roles },
    actorId: actor.id,
    from: String(fd.get('from') ?? ''),
    until: String(fd.get('until') ?? ''),
    backupId: String(fd.get('backupId') ?? ''),
  });
  if (r.ok) refresh();
  return r;
}

export async function endAwayForAction(personId: string) {
  const actor = await requirePeopleManager();
  await endAway(String(personId), actor.id);
  refresh();
  return { ok: true as const, message: 'No longer shown as away.' };
}

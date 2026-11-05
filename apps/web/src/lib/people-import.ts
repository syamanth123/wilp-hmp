import { prisma, RoleName, type Prisma } from '@hmp/db';
import { parseCsv } from '@hmp/integrations';
import { roleLabel } from './labels';
import { impactOfChange, openWork } from './people';
import { DEPARTMENT_ROLES } from './people-save';

/**
 * Bulk people upload (v1.4 §B, section 0): exactly four columns — email, name, roles, department.
 * Preview first (New / Changed / Unchanged / Error per row); Apply saves all rows or none. Upsert by
 * email (lower-case); never deletes anyone. A row that would take away a role or department while the
 * person still has open work is an error here — the Edit screen's impact check handles that safely.
 */

export const PEOPLE_COLUMNS = ['email', 'name', 'roles', 'department'] as const;

export const PEOPLE_TEMPLATE = `email,name,roles,department
# roles: any of ADMIN, IC, HOG, PC, FACULTY, SME — separated by ";" (e.g. HOG;FACULTY)
# department: the department code or name (MBA, CORE, CSIS, EEE); leave empty for IC / Admin only
# a.sharma@pilani.bits-pilani.ac.in,Dr. A. Sharma,HOG;FACULTY,CSIS
# b.rao@pilani.bits-pilani.ac.in,Dr. B. Rao,FACULTY,EEE
`;

const ROLE_WORDS: Record<string, RoleName> = {
  ADMIN: RoleName.ADMIN,
  IC: RoleName.INSTRUCTION_CELL,
  INSTRUCTION_CELL: RoleName.INSTRUCTION_CELL,
  'INSTRUCTION CELL': RoleName.INSTRUCTION_CELL,
  HOG: RoleName.HOG,
  PC: RoleName.PROGRAMME_COMMITTEE,
  PROGRAMME_COMMITTEE: RoleName.PROGRAMME_COMMITTEE,
  'PROGRAMME COMMITTEE': RoleName.PROGRAMME_COMMITTEE,
  FACULTY: RoleName.FACULTY,
  SME: RoleName.SME,
};
const SHORT: Record<RoleName, string> = {
  ADMIN: 'ADMIN',
  INSTRUCTION_CELL: 'IC',
  HOG: 'HOG',
  PROGRAMME_COMMITTEE: 'PC',
  FACULTY: 'FACULTY',
  SME: 'SME',
};

export type RowStatus = 'new' | 'changed' | 'unchanged' | 'error';

export interface PreviewRow {
  line: number;
  email: string;
  name: string;
  roles: RoleName[];
  departmentId: string | null;
  departmentName: string | null;
  status: RowStatus;
  changes: string[];
  error?: string;
  userId?: string;
}

export interface Preview {
  rows: PreviewRow[];
  counts: Record<RowStatus, number>;
  fileError?: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function previewPeople(csv: string): Promise<Preview> {
  const empty = { new: 0, changed: 0, unchanged: 0, error: 0 };
  const { header, rows } = parseCsv(csv);
  const missing = PEOPLE_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length)
    return { rows: [], counts: empty, fileError: `Missing column(s): ${missing.join(', ')}.` };
  if (rows.length === 0)
    return { rows: [], counts: empty, fileError: 'The file has no people in it.' };
  if (rows.length > 2000)
    return { rows: [], counts: empty, fileError: 'At most 2,000 people per file.' };

  const [departments, users] = await Promise.all([
    prisma.department.findMany({ select: { id: true, code: true, name: true, active: true } }),
    prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        active: true,
        departmentId: true,
        roles: { select: { role: { select: { name: true } } } },
      },
    }),
  ]);
  const deptBy = (v: string) =>
    departments.find(
      (d) => d.code.toLowerCase() === v.toLowerCase() || d.name.toLowerCase() === v.toLowerCase(),
    );
  const userBy = new Map(users.map((u) => [u.email.toLowerCase(), u]));
  const hogOf = new Map<string, string>(); // departmentId → email of its active HOG (DB, then file)
  for (const u of users)
    if (u.active && u.departmentId && u.roles.some((r) => r.role.name === RoleName.HOG))
      hogOf.set(u.departmentId, u.email.toLowerCase());

  const seen = new Set<string>();
  const out: PreviewRow[] = [];
  for (const [i, r] of rows.entries()) {
    const line = i + 2;
    const email = (r.email ?? '').trim().toLowerCase();
    const name = (r.name ?? '').trim();
    const roleWords = (r.roles ?? '')
      .split(/[;,]/)
      .map((w) => w.trim().toUpperCase())
      .filter(Boolean);
    const roles = [...new Set(roleWords.map((w) => ROLE_WORDS[w]).filter(Boolean))] as RoleName[];
    const deptText = (r.department ?? '').trim();
    const dept = deptText ? deptBy(deptText) : undefined;
    const row: PreviewRow = {
      line,
      email,
      name,
      roles,
      departmentId: dept?.id ?? null,
      departmentName: dept?.name ?? null,
      status: 'new',
      changes: [],
    };
    const fail = (error: string) => out.push({ ...row, status: 'error', error });
    if (!EMAIL.test(email)) {
      fail('Not a valid email.');
      continue;
    }
    if (seen.has(email)) {
      fail('This email is in the file twice.');
      continue;
    }
    seen.add(email);
    if (!name) {
      fail('Name is empty.');
      continue;
    }
    const unknownRole = roleWords.find((w) => !ROLE_WORDS[w]);
    if (unknownRole || roles.length === 0) {
      fail(
        unknownRole
          ? `“${unknownRole}” isn't a role (use ADMIN, IC, HOG, PC, FACULTY, SME).`
          : 'No role given.',
      );
      continue;
    }
    if (deptText && !dept) {
      fail(`No department “${deptText}”.`);
      continue;
    }
    if (dept && !dept.active) {
      fail(`${dept.name} is inactive.`);
      continue;
    }
    if (roles.some((x) => DEPARTMENT_ROLES.includes(x)) && !dept) {
      fail('HOG, PC, faculty and SME need a department.');
      continue;
    }
    if (roles.includes(RoleName.HOG) && dept) {
      const holder = hogOf.get(dept.id);
      if (holder && holder !== email) {
        fail(`${dept.name} already has a HOG (${holder}). One HOG per department.`);
        continue;
      }
      hogOf.set(dept.id, email);
    }

    const existing = userBy.get(email);
    if (!existing) {
      out.push(row);
      continue;
    }
    row.userId = existing.id;
    const had = existing.roles.map((x) => x.role.name);
    const added = roles.filter((x) => !had.includes(x));
    const removed = had.filter((x) => !roles.includes(x));
    if (existing.name !== name) row.changes.push(`name: ${existing.name} → ${name}`);
    if (added.length) row.changes.push(`adds ${added.map(roleLabel).join(', ')}`);
    if (removed.length) row.changes.push(`removes ${removed.map(roleLabel).join(', ')}`);
    if ((existing.departmentId ?? null) !== row.departmentId) {
      const from = departments.find((d) => d.id === existing.departmentId)?.name ?? 'none';
      row.changes.push(`department: ${from} → ${row.departmentName ?? 'none'}`);
    }
    if (!existing.active) row.changes.push('reactivated');
    if (removed.length || (existing.departmentId ?? null) !== row.departmentId) {
      const hit = impactOfChange((await openWork([existing.id])).get(existing.id) ?? [], {
        removedRoles: removed,
        departmentChanged: (existing.departmentId ?? null) !== row.departmentId,
        deactivated: false,
      });
      if (hit.length) {
        out.push({
          ...row,
          status: 'error',
          error: `Has ${hit.length} open handout${hit.length === 1 ? '' : 's'} in the role or department being changed — use Edit on this person to hand them over first.`,
        });
        continue;
      }
    }
    out.push({ ...row, status: row.changes.length ? 'changed' : 'unchanged' });
  }
  const counts = { ...empty };
  for (const r of out) counts[r.status]++;
  return { rows: out, counts };
}

export async function applyPeople(
  actorId: string,
  csv: string,
): Promise<
  { ok: true; created: number; changed: number } | { ok: false; error: string; preview?: Preview }
> {
  const preview = await previewPeople(csv);
  if (preview.fileError) return { ok: false, error: preview.fileError };
  if (preview.counts.error)
    return { ok: false, error: 'Fix the rows marked Error, then upload again.', preview };
  const roleRows = await prisma.role.findMany();
  const roleId = new Map(roleRows.map((r) => [r.name, r.id]));
  let created = 0;
  let changed = 0;
  await prisma.$transaction(
    async (tx) => {
      for (const r of preview.rows) {
        if (r.status === 'unchanged') continue;
        const user = r.userId
          ? await tx.user.update({
              where: { id: r.userId },
              data: {
                name: r.name,
                departmentId: r.departmentId,
                active: true,
                accessVersion: { increment: 1 },
              },
            })
          : await tx.user.create({
              data: { email: r.email, name: r.name, departmentId: r.departmentId },
            });
        const ids = r.roles.map((x) => roleId.get(x)!);
        await tx.userRole.deleteMany({ where: { userId: user.id, roleId: { notIn: ids } } });
        for (const id of ids)
          await tx.userRole.upsert({
            where: { userId_roleId: { userId: user.id, roleId: id } },
            update: {},
            create: { userId: user.id, roleId: id },
          });
        await tx.auditLog.create({
          data: {
            actorId,
            action: r.userId ? 'user.update' : 'user.create',
            entity: 'User',
            entityId: user.id,
            after: {
              source: 'people upload',
              email: r.email,
              roles: r.roles,
              department: r.departmentName,
              changes: r.changes,
            } as Prisma.InputJsonValue,
          },
        });
        if (r.userId) changed++;
        else created++;
      }
    },
    { timeout: 60_000 },
  );
  return { ok: true, created, changed };
}

/** The current people list in the upload format (edit in Excel, upload again). */
export async function exportPeopleCsv(): Promise<string> {
  const users = await prisma.user.findMany({
    where: { active: true },
    orderBy: { name: 'asc' },
    select: {
      email: true,
      name: true,
      department: { select: { code: true } },
      roles: { select: { role: { select: { name: true } } } },
    },
  });
  const cell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [
    PEOPLE_COLUMNS.join(','),
    ...users.map((u) =>
      [u.email, u.name, u.roles.map((r) => SHORT[r.role.name]).join(';'), u.department?.code ?? '']
        .map(cell)
        .join(','),
    ),
  ].join('\n');
}

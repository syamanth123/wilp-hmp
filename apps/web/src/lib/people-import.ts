import ExcelJS from 'exceljs';
import { prisma, RoleName, type Prisma } from '@hmp/db';
import { parseCsv } from '@hmp/integrations';
import { roleLabel } from './labels';
import { impactOfChange, openWork } from './people';
import { DEPARTMENT_ROLES } from './people-save';
import { adminOnlyProblem } from './people-rules';
import { suggestDepartments, suggestionText, type DeptSuggestion } from './departments';

/**
 * Bulk people upload (v1.4 §B, section 0): exactly four columns — email, name, roles, department.
 * Preview first (New / Changed / Unchanged / Error per row); Apply saves all rows or none. Upsert by
 * email (lower-case); never deletes anyone. A row that would take away a role or department while the
 * person still has open work is an error here — the Edit screen's impact check handles that safely.
 *
 * Decision H6: someone who has no department yet may stay blank in the file; the preview then shows
 * the department their past courses suggest, which is saved only for the rows the Admin / IC ticks
 * ("Accept all suggestions" ticks them all). Mixed history → "Needs a decision", never a guess.
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
  /** Blank department, none yet: the department their past courses point to (saved only if accepted). */
  suggestion?: { departmentId: string; departmentName: string; courses: number };
  /** Blank department, none yet, no single suggestion: why. */
  note?: string;
  needsDecision?: boolean;
  /** Something to fix on Edit person that doesn't block the upload (e.g. an existing bad email). */
  warning?: string;
}

export type PreviewCounts = Record<RowStatus, number> & {
  suggested: number;
  needsDecision: number;
};

export interface Preview {
  rows: PreviewRow[];
  counts: PreviewCounts;
  fileError?: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * `actorIsAdmin: false` (the Instruction Cell): a row that would change an Admin account or give the
 * Admin role is an error. An Admin account's row left exactly as it is passes, so HMP's own download
 * uploads back.
 */
export async function previewPeople(
  csv: string,
  opts: { actorIsAdmin?: boolean } = {},
): Promise<Preview> {
  const actorIsAdmin = opts.actorIsAdmin ?? true;
  const adminAccounts = new Set<number>(); // file lines of existing Admin accounts
  const empty: PreviewCounts = {
    new: 0,
    changed: 0,
    unchanged: 0,
    error: 0,
    suggested: 0,
    needsDecision: 0,
  };
  // Column names in any case ("Email", "EMAIL"); extra columns (e.g. "suggested department") are ignored.
  const parsed = parseCsv(csv);
  const header = parsed.header.map((h) => h.trim().toLowerCase());
  const rows = parsed.rows.map((r) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k.trim().toLowerCase(), v])),
  );
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
      // The account already exists with this exact email (e.g. two addresses joined by a comma by an
      // older import): let HMP's own download upload back, and say what to fix.
      if (!userBy.has(email)) {
        fail('Not a valid email.');
        continue;
      }
      row.warning =
        'Their email in HMP isn’t a single address — fix it with Edit person (BITS sign-in matches their BITS email).';
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
    const existingUser = userBy.get(email);
    // A blank department is fine only for someone who has none yet (the preview suggests one).
    if (
      roles.some((x) => DEPARTMENT_ROLES.includes(x)) &&
      !dept &&
      (!existingUser || existingUser.departmentId)
    ) {
      fail(
        existingUser
          ? 'HOG, PC, faculty and SME need a department — the file leaves it empty.'
          : 'HOG, PC, faculty and SME need a department.',
      );
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
      const notYours = adminOnlyProblem(actorIsAdmin, null, roles);
      if (notYours) {
        fail(notYours);
        continue;
      }
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
    if (had.includes(RoleName.ADMIN)) adminAccounts.add(line);
    if (row.changes.length) {
      const notYours = adminOnlyProblem(actorIsAdmin, had, roles);
      if (notYours) {
        fail(notYours);
        continue;
      }
    }
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

  // H6: suggestions for the rows that stay without a department.
  const blank = out.filter(
    (r) =>
      r.status !== 'error' &&
      r.userId &&
      !r.departmentId &&
      r.roles.some((x) => DEPARTMENT_ROLES.includes(x)),
  );
  const suggested = blank.length
    ? await suggestDepartments(blank.map((r) => r.userId!))
    : new Map<string, DeptSuggestion>();
  for (const r of blank) {
    const s = suggested.get(r.userId!);
    if (!actorIsAdmin && adminAccounts.has(r.line)) {
      r.needsDecision = true;
      r.note = `No department yet (${suggestionText(s)}). This is an Admin account — only an Admin can set it.`;
    } else if (r.roles.includes(RoleName.HOG)) {
      r.needsDecision = true;
      r.note = `No department yet. A Head of Group's department is chosen by hand (${suggestionText(s)}).`;
    } else if (s?.kind === 'one') {
      r.suggestion = {
        departmentId: s.departmentId,
        departmentName: s.departmentName,
        courses: s.courses,
      };
    } else if (s?.kind === 'mixed') {
      r.needsDecision = true;
      r.note = suggestionText(s);
    } else {
      r.needsDecision = true;
      r.note = `No department yet — ${suggestionText(s).toLowerCase()}. Type it in the file.`;
    }
  }

  const counts = { ...empty };
  for (const r of out) {
    counts[r.status]++;
    if (r.suggestion) counts.suggested++;
    if (r.needsDecision) counts.needsDecision++;
  }
  return { rows: out, counts };
}

export async function applyPeople(
  actorId: string,
  csv: string,
  /** File lines whose suggested department the Admin / IC accepted (nothing else is ever taken). */
  acceptLines: number[] = [],
  opts: { actorIsAdmin?: boolean } = {},
): Promise<
  | { ok: true; created: number; changed: number; accepted: number; createdIds: string[] }
  | { ok: false; error: string; preview?: Preview }
> {
  const preview = await previewPeople(csv, opts);
  if (preview.fileError) return { ok: false, error: preview.fileError };
  if (preview.counts.error)
    return { ok: false, error: 'Fix the rows marked Error, then upload again.', preview };
  const accept = new Set(acceptLines);
  let accepted = 0;
  for (const r of preview.rows) {
    if (!r.suggestion || !accept.has(r.line)) continue;
    r.departmentId = r.suggestion.departmentId;
    r.departmentName = r.suggestion.departmentName;
    r.changes.push(
      `department: none → ${r.suggestion.departmentName} (suggested from ${r.suggestion.courses} past course${r.suggestion.courses === 1 ? '' : 's'}, accepted)`,
    );
    r.status = 'changed';
    accepted++;
  }
  const roleRows = await prisma.role.findMany();
  const roleId = new Map(roleRows.map((r) => [r.name, r.id]));
  let created = 0;
  let changed = 0;
  const createdIds: string[] = [];
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
        else {
          created++;
          createdIds.push(user.id);
        }
      }
    },
    { timeout: 60_000 },
  );
  return { ok: true, created, changed, accepted, createdIds };
}

/**
 * The current people list as an Excel file in the upload format (edit, upload again). For everyone
 * without a department it adds the department their past courses suggest (H6) and why; mixed
 * history says "Needs a decision". The department column offers the department codes as a list.
 * The two extra columns are information only — the upload ignores them.
 */
export async function exportPeopleXlsx(): Promise<Buffer> {
  const [users, departments] = await Promise.all([
    prisma.user.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        email: true,
        name: true,
        departmentId: true,
        department: { select: { code: true } },
        roles: { select: { role: { select: { name: true } } } },
      },
    }),
    prisma.department.findMany({ where: { active: true }, orderBy: { code: 'asc' } }),
  ]);
  const blank = users.filter(
    (u) => !u.departmentId && u.roles.some((r) => DEPARTMENT_ROLES.includes(r.role.name)),
  );
  const suggestions = blank.length
    ? await suggestDepartments(blank.map((u) => u.id))
    : new Map<string, DeptSuggestion>();
  const codeOf = new Map(departments.map((d) => [d.id, d.code]));

  const wb = new ExcelJS.Workbook();
  wb.creator = 'HMP';
  const ws = wb.addWorksheet('People', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'email', key: 'email', width: 40 },
    { header: 'name', key: 'name', width: 32 },
    { header: 'roles', key: 'roles', width: 18 },
    { header: 'department', key: 'department', width: 14 },
    { header: 'suggested department', key: 'suggested', width: 22 },
    { header: 'why', key: 'why', width: 62 },
  ];
  ws.getRow(1).font = { bold: true };
  const list = `"${departments.map((d) => d.code).join(',')}"`;
  for (const u of users) {
    const roles = u.roles.map((r) => r.role.name);
    const needs = !u.departmentId && roles.some((r) => DEPARTMENT_ROLES.includes(r));
    const s = needs ? suggestions.get(u.id) : undefined;
    const isHog = roles.includes(RoleName.HOG);
    const row = ws.addRow({
      email: u.email,
      name: u.name,
      roles: roles.map((r) => SHORT[r]).join(';'),
      department: u.department?.code ?? '',
      suggested: s?.kind === 'one' && !isHog ? (codeOf.get(s.departmentId) ?? '') : '',
      why: !needs
        ? ''
        : isHog
          ? `Head of Group: choose the department by hand (${suggestionText(s)})`
          : suggestionText(s),
    });
    row.getCell('department').dataValidation = { type: 'list', allowBlank: true, formulae: [list] };
    if (needs)
      row.getCell('why').font = {
        color: { argb: s?.kind === 'one' && !isHog ? 'FF166534' : 'FF92400E' },
      };
  }

  const help = wb.addWorksheet('How to fill');
  help.columns = [{ width: 110 }];
  for (const line of [
    'HMP people list — edit the People sheet, then Admin → People → Upload people.',
    '',
    'email: their BITS email (how BITS sign-in finds them). One person, one email.',
    'roles: any of ADMIN, IC, HOG, PC, FACULTY, SME, separated by ";" (e.g. HOG;FACULTY).',
    `department: one of ${departments.map((d) => `${d.code} (${d.name})`).join(', ')}. Empty only for IC / Admin.`,
    '',
    'suggested department / why: from the courses each person taught. Information only — the upload',
    'ignores these columns. Either copy a suggestion into "department", or leave "department" empty: the',
    'upload preview then offers the same suggestion to accept (one by one, or "Accept all suggestions").',
    '"Needs a decision" = they taught in more than one department; type the department yourself.',
    '',
    'Nobody is deleted by an upload. Nothing is saved until you press Apply after the preview.',
  ])
    help.addRow([line]);
  help.getRow(1).font = { bold: true };

  return Buffer.from(await wb.xlsx.writeBuffer());
}

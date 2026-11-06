import { prisma, DibbaImportStatus } from '@hmp/db';
import {
  loadDibbaProgrammeLinks,
  resolveDibbaProgramme,
  type DibbaProgrammeLinks,
} from './dibba-programme-codes';

/**
 * Departments (v1.4.0, docs/plans/departments.md §A, decision H6).
 *
 * A programme's department: an HMP programme carries it (H1); a Course Dibba programme code gets it
 * through its linked HMP programme, or — when it has no such link — its own tag on Admin →
 * Departments. A person's *suggested* department comes from the courses they taught (Dibba
 * instructor rows and HMP allocations): one department across all of them → a suggestion; more than
 * one → "Needs a decision". A suggestion is never saved without the Admin / IC confirming it.
 */

export interface DeptRef {
  id: string;
  code: string;
  name: string;
}

// ─── Dibba programme title → department (one click to accept, never automatic) ───────────────────

const TITLE_RULES: { code: string; re: RegExp }[] = [
  { code: 'MBA', re: /\bMBA\b|PG\s*Diploma|Business|Fin\s?Tech|Finance/i },
  {
    code: 'CSIS',
    re: /Software|Comput|Cloud|Information|Artificial Intelligence|Machine Learning|Data Science/i,
  },
  { code: 'EEE', re: /Electronic|VLSI|Embedded|Electrical|Power Engineering/i },
  { code: 'CORE', re: /B\.?\s?Tech|M\.?\s?Tech|M\.?\s?E\.?\s*\(/i },
];

/** The department a Dibba programme title points to, by its words (e.g. "MBA (Finance)" → MBA). */
export function suggestDepartmentForTitle(title: string, departments: DeptRef[]): DeptRef | null {
  for (const rule of TITLE_RULES) {
    if (!rule.re.test(title)) continue;
    return departments.find((d) => d.code.toUpperCase() === rule.code) ?? null;
  }
  return null;
}

// ─── Which department a Dibba code / HMP programme is in ────────────────────────────────────────

export interface DepartmentLinks {
  /** HMP programme id → department id. */
  programmeDept: Map<string, string>;
  /** Dibba code → its own department tag. */
  dibbaCodeDept: Map<string, string>;
  dibba: DibbaProgrammeLinks;
}

export async function loadDepartmentLinks(): Promise<DepartmentLinks> {
  const [programmes, tags, dibba] = await Promise.all([
    prisma.programme.findMany({
      where: { departmentId: { not: null } },
      select: { id: true, departmentId: true },
    }),
    prisma.dibbaProgrammeDepartment.findMany({ select: { code: true, departmentId: true } }),
    loadDibbaProgrammeLinks(),
  ]);
  return {
    programmeDept: new Map(programmes.map((p) => [p.id, p.departmentId!])),
    dibbaCodeDept: new Map(tags.map((t) => [t.code, t.departmentId])),
    dibba,
  };
}

/** A Dibba code's department: its linked HMP programme's (if that has one), else its own tag. */
export function departmentOfDibbaCode(
  code: string,
  links: DepartmentLinks,
): { departmentId: string; via: 'programme' | 'code' } | null {
  const { programme } = resolveDibbaProgramme(code, links.dibba);
  const viaProgramme = programme ? links.programmeDept.get(programme.id) : undefined;
  if (viaProgramme) return { departmentId: viaProgramme, via: 'programme' };
  const own = links.dibbaCodeDept.get(code);
  return own ? { departmentId: own, via: 'code' } : null;
}

// ─── A person's suggested department, from the courses they taught ──────────────────────────────

export type DeptSuggestion =
  | { kind: 'one'; departmentId: string; departmentName: string; courses: number }
  | {
      kind: 'mixed';
      breakdown: { departmentId: string; departmentName: string; courses: number }[];
    }
  | { kind: 'none'; courses: number };

/**
 * One entry per past course: the departments it was taught in (empty = its programme has no
 * department yet). One department across every known course → a suggestion; several → mixed.
 */
export function tallyDepartments(courses: string[][], names: Map<string, string>): DeptSuggestion {
  const counts = new Map<string, number>();
  for (const depts of courses)
    for (const d of new Set(depts)) counts.set(d, (counts.get(d) ?? 0) + 1);
  if (counts.size === 0) return { kind: 'none', courses: courses.length };
  const ranked = [...counts]
    .map(([departmentId, n]) => ({
      departmentId,
      departmentName: names.get(departmentId) ?? '?',
      courses: n,
    }))
    .sort((a, b) => b.courses - a.courses || a.departmentName.localeCompare(b.departmentName));
  if (ranked.length === 1) return { kind: 'one', ...ranked[0]! };
  return { kind: 'mixed', breakdown: ranked };
}

/** "CSIS (from 5 past courses)" / "Needs a decision: 3 CSIS, 2 EEE" / "No past courses in HMP". */
export function suggestionText(s: DeptSuggestion | undefined): string {
  if (!s || (s.kind === 'none' && s.courses === 0)) return 'No past courses in HMP';
  if (s.kind === 'none')
    return `${s.courses} past course${s.courses === 1 ? '' : 's'}, none in a programme with a department yet`;
  if (s.kind === 'one')
    return `${s.departmentName} (from ${s.courses} past course${s.courses === 1 ? '' : 's'})`;
  return `Needs a decision: ${s.breakdown.map((b) => `${b.courses} ${b.departmentName}`).join(', ')}`;
}

/** Suggested departments for these people (every person with teaching history when omitted). */
export async function suggestDepartments(userIds?: string[]): Promise<Map<string, DeptSuggestion>> {
  const userFilter = userIds ? { in: userIds } : undefined;
  const [instructorRows, allocations, links, departments] = await Promise.all([
    prisma.courseInstructor.findMany({
      where: userFilter ? { userId: userFilter } : {},
      select: {
        userId: true,
        termId: true,
        courseCode: true,
        term: { select: { year: true, term: true } },
      },
    }),
    prisma.facultyAssignment.findMany({
      where: userFilter ? { facultyId: userFilter } : {},
      select: {
        facultyId: true,
        request: {
          select: {
            offering: {
              select: {
                course: { select: { code: true, bitsCourseNumber: true } },
                semester: {
                  select: { year: true, term: true, programme: { select: { departmentId: true } } },
                },
              },
            },
          },
        },
      },
    }),
    loadDepartmentLinks(),
    prisma.department.findMany({ select: { id: true, name: true } }),
  ]);

  // Which Dibba programmes each (term, course) was offered in.
  const entries = instructorRows.length
    ? await prisma.dibbaEntry.findMany({
        where: {
          import: {
            status: { in: [DibbaImportStatus.PUBLISHED, DibbaImportStatus.SUPERSEDED] },
            termId: { in: [...new Set(instructorRows.map((r) => r.termId))] },
          },
          courseCode: { in: [...new Set(instructorRows.map((r) => r.courseCode))] },
        },
        select: { courseCode: true, programmeCode: true, import: { select: { termId: true } } },
      })
    : [];
  const codeDept = new Map<string, string | null>();
  const deptOfCode = (code: string) => {
    if (!codeDept.has(code))
      codeDept.set(code, departmentOfDibbaCode(code, links)?.departmentId ?? null);
    return codeDept.get(code) ?? null;
  };
  const offeredIn = new Map<string, Set<string>>(); // `${termId}|${course}` → department ids
  for (const e of entries) {
    const k = `${e.import.termId}|${e.courseCode}`;
    const set = offeredIn.get(k) ?? new Set<string>();
    const d = deptOfCode(e.programmeCode);
    if (d) set.add(d);
    offeredIn.set(k, set);
  }

  // Per person: one entry per distinct past course (term + code), with its departments.
  const perUser = new Map<string, Map<string, Set<string>>>();
  const add = (userId: string, key: string, depts: Iterable<string>) => {
    const courses = perUser.get(userId) ?? new Map<string, Set<string>>();
    const set = courses.get(key) ?? new Set<string>();
    for (const d of depts) set.add(d);
    courses.set(key, set);
    perUser.set(userId, courses);
  };
  for (const r of instructorRows)
    add(
      r.userId,
      `${r.term.year}-${r.term.term}:${r.courseCode}`,
      offeredIn.get(`${r.termId}|${r.courseCode}`) ?? [],
    );
  for (const a of allocations) {
    const o = a.request.offering;
    const d = o.semester.programme.departmentId;
    add(
      a.facultyId,
      `${o.semester.year}-${o.semester.term}:${o.course.bitsCourseNumber ?? o.course.code}`,
      d ? [d] : [],
    );
  }

  const names = new Map(departments.map((d) => [d.id, d.name]));
  return new Map(
    [...perUser].map(([userId, courses]) => [
      userId,
      tallyDepartments(
        [...courses.values()].map((s) => [...s]),
        names,
      ),
    ]),
  );
}

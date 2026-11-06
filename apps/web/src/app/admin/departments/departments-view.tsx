import Link from 'next/link';
import { prisma, RoleName } from '@hmp/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@hmp/ui';
import { Pill } from '@/components/status-badge';
import { loadDibbaCodeRows } from '@/lib/dibba-programme-codes';
import {
  departmentOfDibbaCode,
  loadDepartmentLinks,
  suggestDepartmentForTitle,
} from '@/lib/departments';
import {
  AcceptAllTitleSuggestions,
  DepartmentEditor,
  DepartmentSelect,
  UseSuggestion,
} from './forms';
import type { PeopleBase } from '@/lib/people-access';
import { HogBackfillCard } from './hog-backfill-card';

/**
 * Departments (v1.4.0, docs/plans/departments.md §A): the departments, and which department each
 * programme belongs to — HMP programmes and Course Dibba programme codes. People's suggested
 * departments come from these. Admin under /admin/departments, the Instruction Cell under
 * /ic/departments. No delete: rename or deactivate.
 */
export async function DepartmentsView({ base }: { base: PeopleBase }) {
  const [departments, hogs, peopleCounts, programmes, dibbaRows, links] = await Promise.all([
    prisma.department.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { programmes: true, dibbaCodes: true } } },
    }),
    prisma.user.findMany({
      where: {
        active: true,
        departmentId: { not: null },
        roles: { some: { role: { name: RoleName.HOG } } },
      },
      select: { name: true, departmentId: true },
    }),
    prisma.user.groupBy({
      by: ['departmentId'],
      where: { active: true, departmentId: { not: null } },
      _count: { _all: true },
    }),
    prisma.programme.findMany({
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true, active: true, departmentId: true },
    }),
    loadDibbaCodeRows(),
    loadDepartmentLinks(),
  ]);
  const active = departments.filter((d) => d.active);
  const options = active.map((d) => ({ id: d.id, name: d.name }));
  const nameOf = new Map(departments.map((d) => [d.id, d.name]));
  const hogOf = new Map(hogs.map((h) => [h.departmentId!, h.name]));
  const peopleOf = new Map(peopleCounts.map((c) => [c.departmentId!, c._count._all]));
  const programmeCode = new Map(programmes.map((p) => [p.id, p.code]));

  const dibba = dibbaRows.map((r) => {
    const resolved = departmentOfDibbaCode(r.code, links);
    const suggestion = resolved ? null : suggestDepartmentForTitle(r.title, active);
    return { ...r, dept: resolved, suggestion };
  });
  const dibbaDone = dibba.filter((r) => r.dept).length;
  const suggestions = dibba.filter((r) => r.suggestion).length;
  const programmesDone = programmes.filter((p) => p.departmentId).length;

  return (
    <div className="space-y-4">
      <HogBackfillCard base={base} />
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle>Departments</CardTitle>
            <CardDescription>
              Each department has one Head of Group. People belong to one department (People);
              programmes belong to one department (below). Names can be changed at any time; a
              department no longer used is made inactive (it is never deleted).
            </CardDescription>
          </div>
          <DepartmentEditor />
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm" data-testid="departments-table">
            <thead className="text-muted-foreground text-left text-xs uppercase tracking-wide">
              <tr className="border-b">
                <th className="px-4 py-2 font-medium">Department</th>
                <th className="px-4 py-2 font-medium">Head of Group</th>
                <th className="px-4 py-2 font-medium">People</th>
                <th className="px-4 py-2 font-medium">Programmes</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {departments.map((d) => (
                <tr key={d.id} className="border-b last:border-0" data-testid="department-row">
                  <td className="px-4 py-2">
                    <div className="font-medium">{d.name}</div>
                    <div className="text-muted-foreground font-mono text-xs">{d.code}</div>
                  </td>
                  <td className="px-4 py-2">
                    {hogOf.get(d.id) ?? (
                      <span className="font-medium text-amber-800">No HOG yet</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <Link href={`${base}/people?department=${d.id}`} className="underline">
                      {peopleOf.get(d.id) ?? 0}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    {d._count.programmes} HMP · {d._count.dibbaCodes} Dibba
                  </td>
                  <td className="px-4 py-2">
                    {d.active ? (
                      <Pill tone="green">Active</Pill>
                    ) : (
                      <Pill tone="gray">Inactive</Pill>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <DepartmentEditor
                      dept={{ id: d.id, code: d.code, name: d.name, active: d.active }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base" id="programmes">
            HMP programmes
          </CardTitle>
          <CardDescription data-testid="programmes-summary">
            {programmesDone} of {programmes.length} have a department. A request belongs to its
            programme&apos;s department.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <tbody>
              {programmes.map((p) => (
                <tr key={p.id} className="border-t" data-testid="programme-row">
                  <td className="w-40 px-4 py-2 font-mono text-xs">{p.code}</td>
                  <td className="px-4 py-2">
                    {p.name}
                    {!p.active && <span className="text-muted-foreground"> (inactive)</span>}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <DepartmentSelect
                      kind="programme"
                      target={p.id}
                      value={p.departmentId}
                      departments={options}
                      label={`Department of ${p.code}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base">Course Dibba programmes</CardTitle>
            <CardDescription data-testid="dibba-summary">
              {dibbaDone} of {dibba.length} have a department. HMP uses these to suggest each
              person&apos;s department from the courses they taught. A code linked to an HMP
              programme (Admin → Dibba codes) takes that programme&apos;s department.
              {suggestions > 0 &&
                ` ${suggestions} more have a suggestion from their title — check them, then accept.`}
            </CardDescription>
          </div>
          <AcceptAllTitleSuggestions count={suggestions} />
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="text-muted-foreground text-left text-xs uppercase tracking-wide">
              <tr className="border-b">
                <th className="px-4 py-2 font-medium">Code</th>
                <th className="px-4 py-2 font-medium">Programme (as the Dibba names it)</th>
                <th className="px-4 py-2 font-medium">Courses</th>
                <th className="px-4 py-2 text-right font-medium">Department</th>
              </tr>
            </thead>
            <tbody>
              {dibba.map((r) => (
                <tr key={r.code} className="border-b last:border-0" data-testid="dibba-row">
                  <td className="px-4 py-2 font-mono text-xs">{r.code}</td>
                  <td className="px-4 py-2">{r.title}</td>
                  <td className="px-4 py-2 tabular-nums">{r.courses}</td>
                  <td className="px-4 py-2 text-right">
                    {r.dept?.via === 'programme' ? (
                      <span className="text-sm">
                        {nameOf.get(r.dept.departmentId)}{' '}
                        <span className="text-muted-foreground text-xs">
                          (through{' '}
                          {programmeCode.get(r.resolved.programme?.id ?? '') ?? 'its HMP programme'}
                          )
                        </span>
                      </span>
                    ) : (
                      <span className="inline-flex flex-wrap items-center justify-end gap-2">
                        {r.suggestion && (
                          <UseSuggestion
                            code={r.code}
                            departmentId={r.suggestion.id}
                            name={r.suggestion.name}
                          />
                        )}
                        <DepartmentSelect
                          kind="dibba"
                          target={r.code}
                          value={r.dept?.departmentId ?? null}
                          departments={options}
                          label={`Department of ${r.code}`}
                        />
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

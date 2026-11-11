import Link from 'next/link';
import { getSessionUser } from '@hmp/auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@hmp/ui';
import { BUCKETS, loadDepartmentDashboard, ownDepartment } from '@/lib/department-dashboard';
import { loadText } from '@/lib/people';
import { rememberedChoice, rememberChoice } from '@/lib/preferences';

/**
 * v1.4.2 — department dashboard (docs/plans/v1.4.2-workload.md §5). IC / Admin: every department; a HOG:
 * their own (`own`). Every number opens the Handout Library with that filter.
 */
export async function DepartmentDashboardView({
  own = false,
  searchParams,
  path,
}: {
  own?: boolean;
  searchParams: { term?: string };
  path: string;
}) {
  const me = await getSessionUser();
  if (!me) return null;
  const onlyDepartmentId = own ? ownDepartment(me) : null;
  // F12: the last semester picked here is remembered for this person.
  const asked = searchParams.term ?? (await rememberedChoice(me.id, 'dashboardTerm'));
  const d = await loadDepartmentDashboard(me, { term: asked, onlyDepartmentId });
  if (searchParams.term && d.term === searchParams.term)
    await rememberChoice(me.id, 'dashboardTerm', d.term);

  return (
    <div className="space-y-5" data-testid="department-dashboard">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontWeight: 600, fontSize: 28, margin: 0 }}>
            {own ? 'My department' : 'Department dashboard'}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {d.termText} · every number opens the Handout Library with that list.
          </p>
        </div>
        <form method="get" action={path} className="flex items-center gap-2 text-sm">
          <label htmlFor="dash-term">Semester</label>
          <select
            id="dash-term"
            name="term"
            defaultValue={d.term ?? ''}
            className="border-border rounded-md border bg-white px-2 py-1.5"
          >
            {d.terms.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
          <button type="submit" className="border-border rounded-md border bg-white px-3 py-1.5">
            Show
          </button>
        </form>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Handouts by department</CardTitle>
          <CardDescription>
            Not started = in the Course Dibba with no request yet. Overdue = past the current
            step&apos;s due date (also counted in In progress).
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="department-table">
            <thead>
              <tr className="border-border text-muted-foreground border-b text-left">
                <th className="py-2 pr-3 font-medium">Department</th>
                <th className="py-2 pr-3 font-medium">HOG</th>
                {BUCKETS.map((b) => (
                  <th key={b.key} className="py-2 pr-3 text-right font-medium">
                    {b.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.id} className="border-border border-b" data-testid="department-row">
                  <td className="py-2 pr-3 font-medium">{r.name}</td>
                  <td className="py-2 pr-3">
                    {r.hog ??
                      (r.id === 'none' ? '—' : <span className="text-red-700">no HOG</span>)}
                  </td>
                  {BUCKETS.map((b) => (
                    <td key={b.key} className="py-2 pr-3 text-right tabular-nums">
                      {r.counts[b.key] > 0 ? (
                        <Link
                          href={r.links[b.key]}
                          className={b.key === 'overdue' ? 'font-semibold text-red-700' : undefined}
                        >
                          {r.counts[b.key]}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {d.rows.length > 1 ? (
              <tfoot>
                <tr className="font-semibold">
                  <td className="py-2 pr-3">All</td>
                  <td />
                  {BUCKETS.map((b) => (
                    <td key={b.key} className="py-2 pr-3 text-right tabular-nums">
                      {d.total[b.key]}
                    </td>
                  ))}
                </tr>
              </tfoot>
            ) : null}
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Workload</CardTitle>
          <CardDescription>
            Open handouts per person (all semesters), most overdue first. HOG and PC are always
            listed; others when they have open work.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="workload-table">
            <thead>
              <tr className="border-border text-muted-foreground border-b text-left">
                <th className="py-2 pr-3 font-medium">Person</th>
                <th className="py-2 pr-3 font-medium">Role</th>
                {own ? null : <th className="py-2 pr-3 font-medium">Department</th>}
                <th className="py-2 pr-3 text-right font-medium">Open</th>
                <th className="py-2 pr-3 text-right font-medium">Due this week</th>
                <th className="py-2 pr-3 text-right font-medium">Overdue</th>
                <th className="py-2 pr-3 font-medium">Away</th>
              </tr>
            </thead>
            <tbody>
              {d.workload.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-muted-foreground py-3">
                    Nobody has open handouts.
                  </td>
                </tr>
              ) : (
                d.workload.map((p) => (
                  <tr key={p.id} className="border-border border-b" data-testid="workload-row">
                    <td className="py-2 pr-3" title={loadText(p.load)}>
                      {p.name}
                    </td>
                    <td className="py-2 pr-3">{p.roles.join(', ')}</td>
                    {own ? null : (
                      <td className="py-2 pr-3">
                        {p.department ?? <span className="text-amber-800">not set</span>}
                      </td>
                    )}
                    <td className="py-2 pr-3 text-right tabular-nums">{p.load.open}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{p.load.dueThisWeek}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {p.load.overdue > 0 ? (
                        <span className="font-semibold text-red-700">{p.load.overdue}</span>
                      ) : (
                        0
                      )}
                    </td>
                    <td className="py-2 pr-3 text-sky-900">{p.away ?? ''}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

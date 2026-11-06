import Link from 'next/link';
import { prisma, RoleName } from '@hmp/db';
import { getSessionUser } from '@hmp/auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@hmp/ui';
import { Pill } from '@/components/status-badge';
import { facultyTypeLabel, roleLabel } from '@/lib/labels';
import { loadPeople, loadText, type PeopleFilter } from '@/lib/people';
import { suggestDepartments, suggestionText } from '@/lib/departments';
import type { PeopleBase } from '@/lib/people-access';

/**
 * People (v1.4, docs/plans/departments.md §B): everyone with their roles, department and open work;
 * add, edit (with the impact check), upload many, download the list. Shown to the Admin under
 * /admin/people and to the Instruction Cell under /ic/people — who can't change Admin accounts.
 */
export async function PeopleView({
  base,
  searchParams = {},
}: {
  base: PeopleBase;
  searchParams?: Record<string, string | undefined>;
}) {
  const me = await getSessionUser();
  const viewerIsAdmin = !!me?.roles.includes(RoleName.ADMIN);
  const f: PeopleFilter = {
    q: (searchParams.q ?? '').trim().slice(0, 80),
    role: (Object.values(RoleName) as string[]).includes(searchParams.role ?? '')
      ? (searchParams.role as RoleName)
      : '',
    department: searchParams.department ?? '',
    status:
      searchParams.status === 'inactive'
        ? 'inactive'
        : searchParams.status === 'all'
          ? ''
          : 'active',
  };
  const [people, departments, noDeptPeople] = await Promise.all([
    loadPeople(f),
    prisma.department.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.user.findMany({
      select: { id: true },
      where: {
        active: true,
        departmentId: null,
        roles: {
          some: {
            role: {
              name: {
                in: [RoleName.HOG, RoleName.PROGRAMME_COMMITTEE, RoleName.FACULTY, RoleName.SME],
              },
            },
          },
        },
      },
    }),
  ]);
  // H6: what each person without a department taught (suggestion / needs a decision).
  const suggestions = await suggestDepartments(noDeptPeople.map((u) => u.id));
  const noDept = noDeptPeople.length;
  const withSuggestion = [...suggestions.values()].filter((s) => s.kind === 'one').length;
  const select = 'bg-background h-9 rounded-md border px-2 text-sm';

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle>People</CardTitle>
            <CardDescription>
              Everyone who can sign in to HMP with their BITS ID — their roles, department and open
              work. One person, one email, one department (Instruction Cell and Admin: all).{' '}
              {viewerIsAdmin ? (
                <>
                  <Link
                    href="/admin/users"
                    className="underline"
                    data-testid="people-password-accounts"
                  >
                    Password sign-in accounts
                  </Link>{' '}
                  (only where BITS sign-in isn&apos;t used).
                </>
              ) : (
                <span data-testid="people-ic-limits">
                  Admin accounts and the Admin role are changed by an Admin.
                </span>
              )}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`${base}/people/new`}
              className="inline-flex h-9 items-center rounded-md bg-[var(--bits-navy)] px-3 text-sm font-medium text-white"
              data-testid="people-add"
            >
              Add person
            </Link>
            <Link
              href={`${base}/people/upload`}
              className="hover:bg-accent inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium"
            >
              Upload people (CSV / Excel)
            </Link>
            <a
              href={`${base}/people/export`}
              className="hover:bg-accent inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium"
              download
            >
              Download the list (Excel)
            </a>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {noDept > 0 && (
            <p
              className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950"
              data-testid="people-no-department"
            >
              {noDept} active {noDept === 1 ? 'person has' : 'people have'} a HOG, PC, faculty or
              SME role but no department
              {withSuggestion > 0 &&
                ` — ${withSuggestion} of them have a suggested department from the courses they taught`}
              .{' '}
              <Link href={`${base}/people?department=none`} className="underline">
                Show them
              </Link>
              {withSuggestion > 0 && (
                <>
                  {' '}
                  · To fill them in one go:{' '}
                  <a href={`${base}/people/export`} className="underline" download>
                    download the list
                  </a>
                  , then{' '}
                  <Link href={`${base}/people/upload`} className="underline">
                    upload it
                  </Link>{' '}
                  and press <em>Accept all suggestions</em>.
                </>
              )}
            </p>
          )}
          <form className="flex flex-wrap items-end gap-2" method="get">
            <input
              name="q"
              defaultValue={f.q}
              placeholder="Search name or email"
              className={`${select} w-64`}
              aria-label="Search name or email"
            />
            <select name="role" defaultValue={f.role} className={select} aria-label="Role">
              <option value="">Any role</option>
              {Object.values(RoleName).map((r) => (
                <option key={r} value={r}>
                  {roleLabel(r)}
                </option>
              ))}
            </select>
            <select
              name="department"
              defaultValue={f.department}
              className={select}
              aria-label="Department"
            >
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
              <option value="none">No department</option>
            </select>
            <select
              name="status"
              defaultValue={searchParams.status ?? 'active'}
              className={select}
              aria-label="Status"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="all">Everyone</option>
            </select>
            <button
              className="hover:bg-accent h-9 rounded-md border px-3 text-sm font-medium"
              type="submit"
            >
              Show
            </button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <p className="text-muted-foreground border-b px-4 py-2 text-sm">
            <span data-testid="list-total">{people.length}</span>{' '}
            {people.length === 1 ? 'person' : 'people'}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground text-left text-xs uppercase tracking-wide">
                <tr className="border-b">
                  <th className="px-4 py-2 font-medium">Person</th>
                  <th className="px-4 py-2 font-medium">Roles</th>
                  <th className="px-4 py-2 font-medium">Department</th>
                  <th className="px-4 py-2 font-medium">Faculty type</th>
                  <th className="px-4 py-2 font-medium">Open work</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.id} className="border-b last:border-0" data-testid="person-row">
                    <td className="px-4 py-2">
                      <div className="font-medium">{p.name}</div>
                      <div className="text-muted-foreground font-mono text-xs">{p.email}</div>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-1">
                        {p.roles.map((r) => (
                          <Pill key={r} tone="navy">
                            {roleLabel(r)}
                          </Pill>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      {p.departmentName ??
                        (p.roles.every((r) => r === 'ADMIN' || r === 'INSTRUCTION_CELL') ? (
                          <span className="text-muted-foreground">All</span>
                        ) : (
                          <span>
                            <span className="text-muted-foreground">— not set</span>
                            {suggestions.has(p.id) && (
                              <span
                                className={`block text-xs ${
                                  suggestions.get(p.id)!.kind === 'one'
                                    ? 'text-emerald-800'
                                    : 'text-amber-800'
                                }`}
                                data-testid="person-suggestion"
                              >
                                {suggestions.get(p.id)!.kind === 'one' ? 'Suggested: ' : ''}
                                {suggestionText(suggestions.get(p.id))}
                              </span>
                            )}
                          </span>
                        ))}
                    </td>
                    <td className="px-4 py-2">
                      {p.facultyType ? facultyTypeLabel(p.facultyType as never) : '—'}
                    </td>
                    <td className={`px-4 py-2 ${p.load.overdue ? 'font-medium text-red-700' : ''}`}>
                      {loadText(p.load)}
                    </td>
                    <td className="px-4 py-2">
                      {p.active ? (
                        <Pill tone="green">Active</Pill>
                      ) : (
                        <Pill tone="gray">Inactive</Pill>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Link
                        href={`${base}/people/${p.id}`}
                        className="underline"
                        data-testid="person-edit"
                      >
                        {!viewerIsAdmin && p.roles.includes(RoleName.ADMIN) ? 'View' : 'Edit'}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { RoleName } from '@hmp/db';
import { getSessionUser } from '@hmp/auth';
import { Card, CardContent } from '@hmp/ui';
import { StatusBadge, statusLabel } from '@/components/status-badge';
import { formatDate } from '@/lib/format-date';
import {
  PAGE_SIZE,
  TABS,
  libraryHref,
  loadLibrary,
  parseLibraryFilter,
  termLabel,
  type LibraryFilter,
  type Tab,
} from '@/lib/handout-library';
import { seesAllWork } from '@/lib/handout-access';
import { LibraryFilters } from './library-filters';

export const dynamic = 'force-dynamic';

function tabLabel(tab: Tab, roles: RoleName[]): string {
  if (tab === 'published') return 'Published';
  if (tab === 'past') return 'Past BITS handouts';
  return seesAllWork({ id: '', roles }) ? 'In progress' : 'My handouts';
}

const TAB_HINT: Record<Tab, string> = {
  published: 'Approved and published handouts — open to everyone as a reference.',
  'in-progress': 'Handouts being written or reviewed.',
  past: 'Handouts imported from the BITS Word files, approved for reuse.',
};

export default async function HandoutLibraryPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  const f = parseLibraryFilter(searchParams, user.roles);
  const lib = await loadLibrary(user, f, statusLabel);
  const totalPages = Math.max(1, Math.ceil(lib.totalGroups / PAGE_SIZE));
  const here = (changes: Partial<LibraryFilter>) => libraryHref({ ...f, page: 1, ...changes });

  const chips: { label: string; clear: Partial<LibraryFilter> }[] = [];
  if (f.q) chips.push({ label: `Search: “${f.q}”`, clear: { q: '' } });
  if (f.term)
    chips.push({
      label: f.term === 'all' ? 'All semesters' : termLabel(f.term),
      clear: { term: '' },
    });
  if (f.programme) chips.push({ label: `Programme: ${f.programme}`, clear: { programme: '' } });
  if (f.status) chips.push({ label: statusLabel(f.status), clear: { status: '' } });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-serif text-2xl font-bold">Handout Library</h1>
        <p className="text-muted-foreground text-sm">
          Every handout you may see — published, in progress and past BITS handouts — in one place.
        </p>
      </div>

      {/* Tabs */}
      <nav className="flex flex-wrap gap-2 border-b pb-2 text-sm" aria-label="Library sections">
        {TABS.map((t) => {
          const active = t === f.tab;
          return (
            <Link
              key={t}
              href={libraryHref({ tab: t })}
              aria-current={active ? 'page' : undefined}
              data-testid={`library-tab-${t}`}
              className={
                active
                  ? 'bg-accent text-foreground rounded-md px-3 py-1.5 font-medium'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground rounded-md px-3 py-1.5'
              }
            >
              {tabLabel(t, user.roles)}{' '}
              <span className="bg-background ml-1 rounded-full px-1.5 text-xs tabular-nums">
                {lib.tabCounts[t]}
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="grid gap-4 lg:grid-cols-[250px_1fr]">
        {/* Filter panel */}
        <Card className="h-fit">
          <CardContent className="pt-5">
            <LibraryFilters
              q={f.q}
              term={f.term}
              programme={f.programme}
              status={f.status}
              showHmpFilters={f.tab !== 'past'}
              terms={lib.facets.term}
              programmes={lib.facets.programme}
              statuses={lib.facets.status}
            />
          </CardContent>
        </Card>

        <div className="space-y-3">
          <p className="text-muted-foreground text-sm">{TAB_HINT[f.tab]}</p>

          {/* Quick views */}
          {lib.views.length > 0 && (
            <div className="flex flex-wrap gap-2" aria-label="Quick views">
              {lib.views.map((v) => (
                <Link
                  key={v.key}
                  href={libraryHref({ tab: f.tab, view: v.key, q: f.q, programme: f.programme })}
                  aria-current={v.active ? 'true' : undefined}
                  data-testid={`quick-view-${v.key}`}
                  className={
                    v.active
                      ? 'rounded-full border border-transparent bg-[var(--bits-navy)] px-3 py-1 text-sm font-medium text-white'
                      : 'hover:bg-accent rounded-full border px-3 py-1 text-sm'
                  }
                >
                  {v.label} <span className="tabular-nums opacity-80">({v.count})</span>
                </Link>
              ))}
            </div>
          )}

          {/* Active filters */}
          {chips.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-sm" aria-label="Active filters">
              {chips.map((c) => (
                <Link
                  key={c.label}
                  href={here(c.clear)}
                  className="bg-accent inline-flex items-center gap-1 rounded-full px-3 py-1"
                  aria-label={`Remove filter ${c.label}`}
                >
                  {c.label} <span aria-hidden>✕</span>
                </Link>
              ))}
              <Link href={libraryHref({ tab: f.tab })} className="text-muted-foreground underline">
                Clear all
              </Link>
            </div>
          )}

          <Card>
            <CardContent className="p-0">
              <div className="text-muted-foreground flex items-center justify-between border-b px-4 py-2 text-sm">
                <span data-testid="list-total">
                  {lib.totalGroups} {lib.totalGroups === 1 ? 'course' : 'courses'} ·{' '}
                  {lib.totalItems} {lib.totalItems === 1 ? 'handout' : 'handouts'}
                </span>
                <span>Newest first</span>
              </div>
              {lib.groups.length === 0 ? (
                <p className="text-muted-foreground px-4 py-10 text-center text-sm">
                  Nothing here with these filters.{' '}
                  <Link href={libraryHref({ tab: f.tab, view: 'all' })} className="underline">
                    Show all semesters
                  </Link>
                  .
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-muted-foreground text-left text-xs uppercase tracking-wide">
                    <tr className="border-b">
                      <th className="px-4 py-2 font-medium">Course</th>
                      <th className="px-4 py-2 font-medium">Latest handout</th>
                      <th className="px-4 py-2 font-medium">
                        {f.tab === 'past' ? 'Instructor' : 'Faculty / SME'}
                      </th>
                      <th className="px-4 py-2 font-medium">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lib.groups.map(({ latest: it, olderCount }) => (
                      <tr
                        key={`${it.kind}-${it.id}`}
                        className="hover:bg-accent/40 border-b last:border-0"
                        data-testid="library-row"
                      >
                        <td className="px-4 py-3 align-top">
                          <Link
                            href={
                              it.kind === 'past' ? `/handouts/past/${it.id}` : `/handouts/${it.id}`
                            }
                            className="font-medium text-[var(--bits-navy)] hover:underline"
                          >
                            {it.courseCode}
                          </Link>
                          <div className="text-muted-foreground">{it.courseTitle}</div>
                        </td>
                        <td className="px-4 py-3 align-top">
                          {it.status ? (
                            <StatusBadge status={it.status} />
                          ) : (
                            <span className="badge badge-gray">Past BITS handout</span>
                          )}
                          <div className="text-muted-foreground mt-1 text-xs">
                            {[it.semesterName, it.programmeCode, it.refNo]
                              .filter(Boolean)
                              .join(' · ')}
                          </div>
                          {olderCount > 0 && (
                            <Link
                              href={`/handouts/course/${encodeURIComponent(it.courseCode)}`}
                              className="mt-1 inline-block text-xs underline"
                            >
                              {olderCount} more for this course
                            </Link>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div>
                            {it.faculty.join(', ') || (
                              <span className="text-muted-foreground">Not assigned yet</span>
                            )}
                          </div>
                          {it.sme && (
                            <div className="text-muted-foreground text-xs">SME: {it.sme}</div>
                          )}
                        </td>
                        <td className="text-muted-foreground whitespace-nowrap px-4 py-3 align-top">
                          {formatDate(it.updatedAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          {totalPages > 1 && (
            <nav className="flex items-center justify-between text-sm" aria-label="Pages">
              {f.page > 1 ? (
                <Link href={libraryHref({ ...f, page: f.page - 1 })} className="underline">
                  ← Previous
                </Link>
              ) : (
                <span />
              )}
              <span className="text-muted-foreground">
                Page {f.page} of {totalPages}
              </span>
              {f.page < totalPages ? (
                <Link href={libraryHref({ ...f, page: f.page + 1 })} className="underline">
                  Next →
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </div>
      </div>
    </div>
  );
}

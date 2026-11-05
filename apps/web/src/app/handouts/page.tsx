import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma, RoleName } from '@hmp/db';
import { getSessionUser } from '@hmp/auth';
import { Card, CardContent } from '@hmp/ui';
import { Pill, StatusBadge } from '@/components/status-badge';
import { formatDate } from '@/lib/format-date';
import { dueText } from '@/lib/due-text';
import {
  FILTER_KEYS,
  PAGE_SIZE,
  appliesTo,
  filterChipLabel,
  groupMeta,
  isBareAddress,
  libraryHref,
  libraryQuery,
  quickViews,
  type LibraryFilter,
  type LibraryItem,
  type SortKey,
  type Tab,
} from '@/lib/handout-library';
import { seesAllWork } from '@/lib/handout-access';
import { LAST_VIEW_COOKIE, lastViewFor, loadLibraryFromAddress } from '@/lib/handout-library-load';
import { LibraryFilters } from './library-filters';
import { SaveViewButton, SavedViewChip } from './saved-views';

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

const itemHref = (it: LibraryItem) =>
  it.kind === 'past'
    ? `/handouts/past/${it.id}`
    : it.kind === 'not-started'
      ? `/handouts/course/${encodeURIComponent(it.courseCode)}`
      : `/handouts/${it.id}`;

/** Every code the course goes by: "MBA ZC417 / PDBA ZC417", "ET ZC232 / ENGG ZC232". */
const codesText = (it: LibraryItem) =>
  [...new Set(it.codes.filter((c) => c && c !== '—'))].join(' / ') || it.courseCode;

/** The new-request page, filled in with this not-started course and its semester. */
const createRequestHref = (it: LibraryItem) =>
  `/ic/requests/new?${new URLSearchParams({ courses: it.codes.join(','), term: it.termKey ?? '' })}`;

const DAY_SHORT: Record<string, string> = { SAT: 'Sat', SUN: 'Sun', FRI: 'Fri' };

/** "Slot 3 · Sat FN; Slot 7 · Sun AN" — each distinct slot once, at most two. */
const scheduleText = (it: LibraryItem) =>
  [
    ...new Set(
      it.schedule.map((s) =>
        s.slot === 0
          ? 'no slot'
          : `Slot ${s.slot}${s.day ? ` · ${DAY_SHORT[s.day] ?? s.day} ${s.session ?? ''}`.trimEnd() : ''}`,
      ),
    ),
  ]
    .slice(0, 2)
    .join('; ');

function DueCell({ it, tab, now }: { it: LibraryItem; tab: Tab; now: Date }) {
  if (tab === 'published') {
    if (it.group === 'published' && it.publishedAt) {
      return (
        <span>
          {it.taxila === 'export' ? 'Export downloaded' : 'Published to Taxila'}
          <span className="text-muted-foreground block text-xs">
            on {formatDate(it.publishedAt)}
          </span>
        </span>
      );
    }
    if (it.group === 'approved') return <span>Approved — not yet published</span>;
    return <span className="text-muted-foreground">—</span>;
  }
  if (!it.dueAt) return <span className="text-muted-foreground">—</span>;
  const d = dueText(it.dueAt, now);
  return (
    <span
      data-testid="due"
      data-tone={d.tone}
      className={
        d.tone === 'overdue'
          ? 'font-semibold text-red-700'
          : d.tone === 'soon'
            ? 'font-medium text-amber-800'
            : ''
      }
    >
      {d.text}
    </span>
  );
}

export default async function HandoutLibraryPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  // Decision D3: a bare /handouts reopens the person's last view (a browser cookie).
  let sp = searchParams;
  let restored = false;
  if (isBareAddress(searchParams)) {
    const last = lastViewFor(cookies().get(LAST_VIEW_COOKIE)?.value, user.id);
    if (last) {
      sp = Object.fromEntries(new URLSearchParams(last));
      restored = true;
    }
  }

  const now = new Date();
  const [lib, saved] = await Promise.all([
    loadLibraryFromAddress(user, sp, now),
    prisma.savedView.findMany({
      where: { userId: user.id },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, query: true },
    }),
  ]);
  const f = lib.filter;
  const oversight = seesAllWork(user);
  const canCreateRequest =
    user.roles.includes(RoleName.INSTRUCTION_CELL) || user.roles.includes(RoleName.ADMIN);
  const totalPages = Math.max(1, Math.ceil(lib.totalGroups / PAGE_SIZE));
  const here = (changes: Partial<LibraryFilter>) => libraryHref({ ...f, page: 1, ...changes });
  const query = libraryQuery({ ...f, page: 1 });
  const defaultView = quickViews(user.roles)[0];

  const chips = FILTER_KEYS.filter((k) => f[k] && appliesTo(k, f.tab)).map((k) => ({
    key: k,
    label: filterChipLabel(k, f[k], lib),
    href: here({ [k]: '' }),
  }));

  const sortHref = (key: SortKey) =>
    here({
      sort: key,
      dir:
        f.sort === key && !f.dir ? (key === 'updated' || key === 'semester' ? 'asc' : 'desc') : '',
    });
  const sortMark = (key: SortKey) =>
    f.sort === key
      ? f.dir
        ? f.dir === 'asc'
          ? ' ↑'
          : ' ↓'
        : key === 'updated' || key === 'semester'
          ? ' ↓'
          : ' ↑'
      : '';
  const ariaSort = (key: SortKey) =>
    f.sort !== key
      ? undefined
      : (f.dir || (key === 'updated' || key === 'semester' ? 'desc' : 'asc')) === 'asc'
        ? 'ascending'
        : 'descending';
  const SortHead = ({ k, children }: { k: SortKey; children: React.ReactNode }) => (
    <th className="px-4 py-2 font-medium" aria-sort={ariaSort(k)}>
      <Link
        href={sortHref(k)}
        className="hover:text-foreground hover:underline"
        data-testid={`sort-${k}`}
      >
        {children}
        {sortMark(k)}
      </Link>
    </th>
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-serif text-2xl font-bold">Handout Library</h1>
        <p className="text-muted-foreground text-sm">
          Every handout you may see — published, in progress and past BITS handouts — in one place.
        </p>
      </div>

      {restored && defaultView && (
        <p className="text-muted-foreground text-sm" data-testid="restored-view">
          Showing the view you used last.{' '}
          <Link
            href={libraryHref({ tab: defaultView.tab, view: defaultView.key })}
            className="underline"
          >
            Back to {defaultView.label.toLowerCase()}
          </Link>
        </p>
      )}

      {/* Tabs */}
      <nav className="flex flex-wrap gap-2 border-b pb-2 text-sm" aria-label="Library sections">
        {lib.tabs.map(({ tab: t, count, href }) => {
          const active = t === f.tab;
          return (
            <Link
              key={t}
              href={href}
              aria-current={active ? 'page' : undefined}
              data-testid={`library-tab-${t}`}
              className={
                active
                  ? 'bg-accent text-foreground rounded-md px-3 py-1.5 font-medium'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground rounded-md px-3 py-1.5'
              }
            >
              {tabLabel(t, user.roles)}{' '}
              <span
                className="bg-background ml-1 rounded-full px-1.5 text-xs tabular-nums"
                data-testid="tab-count"
              >
                {count}
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="grid gap-4 lg:grid-cols-[290px_1fr]">
        <LibraryFilters
          userId={user.id}
          tab={f.tab}
          values={Object.fromEntries(FILTER_KEYS.map((k) => [k, f[k]]))}
          effectiveTerm={lib.effectiveTerm}
          currentTerm={lib.currentTerm}
          currentTermName={lib.currentTermName}
          facets={lib.facets}
          showPeople={oversight}
          changeComputed={lib.changeComputed}
          activeCount={chips.length}
          query={query}
        />

        <div className="min-w-0 space-y-3">
          <p className="text-muted-foreground text-sm">{TAB_HINT[f.tab]}</p>

          {/* Quick views — the role's, on every tab; each opens its own tab */}
          <div className="flex flex-wrap gap-2" aria-label="Quick views" role="group">
            {lib.views.map((v) => (
              <Link
                key={v.key}
                href={v.href}
                aria-current={v.active ? 'true' : undefined}
                data-testid={`quick-view-${v.key}`}
                className={
                  v.active
                    ? 'rounded-full border border-transparent bg-[var(--bits-navy)] px-3 py-1 text-sm font-medium text-white'
                    : 'hover:bg-accent rounded-full border px-3 py-1 text-sm'
                }
              >
                {v.label}
                {v.count !== null && (
                  <span className="tabular-nums opacity-80" data-testid="quick-view-count">
                    {' '}
                    ({v.count})
                  </span>
                )}
                {v.external && <span aria-hidden> ↗</span>}
              </Link>
            ))}
          </div>

          {saved.length > 0 && (
            <div
              className="flex flex-wrap items-center gap-2 text-sm"
              aria-label="Saved views"
              role="group"
            >
              <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
                Saved
              </span>
              {saved.map((s) => (
                <SavedViewChip
                  key={s.id}
                  id={s.id}
                  name={s.name}
                  href={`/handouts${s.query}`}
                  active={s.query === query}
                />
              ))}
            </div>
          )}

          {/* Active filters */}
          {chips.length > 0 && (
            <div
              className="flex flex-wrap items-center gap-2 text-sm"
              aria-label="Active filters"
              data-testid="active-filters"
            >
              {chips.map((c) => (
                <Link
                  key={c.key}
                  href={c.href}
                  className="bg-accent inline-flex items-center gap-1 rounded-full px-3 py-1"
                  aria-label={`Remove filter: ${c.label}`}
                  data-testid="filter-chip"
                >
                  {c.label} <span aria-hidden>✕</span>
                </Link>
              ))}
              <Link
                href={libraryHref({ tab: f.tab, view: f.view })}
                className="text-muted-foreground underline"
                data-testid="clear-all"
              >
                Clear all
              </Link>
            </div>
          )}

          <Card>
            <CardContent className="p-0">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 text-sm">
                <span className="text-muted-foreground" data-testid="list-total">
                  {lib.totalGroups} {lib.totalGroups === 1 ? 'course' : 'courses'} ·{' '}
                  {lib.totalItems} {lib.totalItems === 1 ? 'handout' : 'handouts'}
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <SaveViewButton query={query} />
                  {oversight && (
                    <a
                      href={`/api/handouts/library/export${query}`}
                      className="bg-background hover:bg-accent inline-flex items-center rounded-md border px-3 py-1.5 text-sm font-medium"
                      data-testid="export-excel"
                      download
                    >
                      Export to Excel
                    </a>
                  )}
                </div>
              </div>
              {lib.groups.length === 0 ? (
                <div
                  className="text-muted-foreground px-4 py-10 text-center text-sm"
                  data-testid="library-empty"
                >
                  <p>
                    {lib.view
                      ? `Nothing under “${lib.view.label}” with these filters.`
                      : 'Nothing matches these filters.'}
                  </p>
                  <p className="mt-2 space-x-3">
                    {lib.effectiveTerm === 'current' && (
                      <Link href={here({ term: 'all' })} className="underline">
                        Try all semesters
                      </Link>
                    )}
                    {chips.length > 0 && (
                      <Link href={libraryHref({ tab: f.tab, view: f.view })} className="underline">
                        Clear the filters
                      </Link>
                    )}
                    {lib.view && (
                      <Link href={libraryHref({ tab: f.tab })} className="underline">
                        Show everything in this tab
                      </Link>
                    )}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-muted-foreground text-left text-xs uppercase tracking-wide">
                      <tr className="border-b">
                        <SortHead k="code">Course</SortHead>
                        {f.tab === 'past' ? (
                          <SortHead k="semester">Handout</SortHead>
                        ) : (
                          <SortHead k="status">Latest handout</SortHead>
                        )}
                        {f.tab === 'in-progress' && <SortHead k="due">Due</SortHead>}
                        {f.tab === 'published' && (
                          <th className="px-4 py-2 font-medium">Published</th>
                        )}
                        <th className="px-4 py-2 font-medium">
                          {f.tab === 'past' ? 'Instructor' : 'Faculty / SME'}
                        </th>
                        <SortHead k="updated">Updated</SortHead>
                      </tr>
                    </thead>
                    <tbody>
                      {lib.groups.map(({ latest: it, olderCount }) => (
                        <tr
                          key={`${it.kind}-${it.id}`}
                          className="hover:bg-accent/40 border-b last:border-0"
                          data-testid="library-row"
                          data-kind={it.kind}
                        >
                          <td className="px-4 py-3 align-top">
                            <Link
                              href={itemHref(it)}
                              className="font-medium text-[var(--bits-navy)] hover:underline"
                              data-testid="library-row-link"
                            >
                              {codesText(it)}
                            </Link>
                            <div className="text-muted-foreground">{it.courseTitle}</div>
                          </td>
                          <td className="px-4 py-3 align-top">
                            {it.kind === 'not-started' ? (
                              <>
                                <Pill tone="gray">Not started</Pill>
                                {canCreateRequest && (
                                  <Link
                                    href={createRequestHref(it)}
                                    className="bg-background hover:bg-accent ml-2 inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium"
                                    data-testid="create-request"
                                  >
                                    Create request
                                  </Link>
                                )}
                              </>
                            ) : it.status ? (
                              it.group === 'published' && it.status !== 'PUBLISHED' ? (
                                <Pill tone="navy">{groupMeta('published').label}</Pill>
                              ) : (
                                <StatusBadge status={it.status} />
                              )
                            ) : (
                              <Pill tone="gray">Past BITS handout</Pill>
                            )}
                            <div className="text-muted-foreground mt-1 text-xs">
                              {[
                                it.semesterName,
                                it.programmeCode ?? (it.programmes.join(', ') || null),
                                it.refNo,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </div>
                            {it.schedule.length > 0 && (
                              <div className="text-muted-foreground text-xs">
                                Schedule: {scheduleText(it)}
                              </div>
                            )}
                            {olderCount > 0 && (
                              <Link
                                href={`/handouts/course/${encodeURIComponent(it.courseCode)}`}
                                className="mt-1 inline-block text-xs underline"
                              >
                                {olderCount} more for this course
                              </Link>
                            )}
                          </td>
                          {f.tab !== 'past' && (
                            <td className="whitespace-nowrap px-4 py-3 align-top">
                              <DueCell it={it} tab={f.tab} now={now} />
                            </td>
                          )}
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
                            {it.kind === 'not-started' ? '—' : formatDate(it.updatedAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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

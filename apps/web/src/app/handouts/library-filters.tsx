'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { Facet, FilterKey, Tab } from '@/lib/handout-library';

interface Props {
  userId: string;
  tab: Tab;
  values: Record<string, string>;
  /** The semester the list shows: 'current' | 'all' | a term key. */
  effectiveTerm: string;
  currentTerm: string | null;
  currentTermName: string | null;
  facets: Partial<Record<FilterKey, Facet[]>>;
  /** Faculty / SME / allocated-by filters (oversight roles only). */
  showPeople: boolean;
  /** "Changed vs last year" sizes were worked out for this list (decision D4). */
  changeComputed: boolean;
  activeCount: number;
  /** The current address (without page) — remembered as the last view (decision D3). */
  query: string;
}

interface Suggestion {
  key: string;
  label: string;
  hint: string;
  apply: Record<string, string>;
}

const LAST_VIEW_COOKIE = 'hmp_lib_last';
const labelCls = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground';
const fieldCls =
  'h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';
const count = (n: number | null) => (n === null ? '' : ` (${n})`);

/**
 * The library's filter panel. Every change updates the address straight away (no Apply button),
 * so a view can be bookmarked or shared; the server does all filtering inside the user's scope.
 */
export function LibraryFilters(p: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(p.values.q ?? '');
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(-1);
  const [showList, setShowList] = useState(false);

  const go = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params?.toString() ?? '');
    if (!next.has('tab')) next.set('tab', p.tab); // keep the tab when leaving the bare address
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete('page');
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  // Decision D3: remember the last view in a browser cookie — written only when it changes.
  useEffect(() => {
    if (!p.query) return;
    const value = encodeURIComponent(`${p.userId}|${p.query}`);
    const current = document.cookie
      .split('; ')
      .find((c) => c.startsWith(`${LAST_VIEW_COOKIE}=`))
      ?.slice(LAST_VIEW_COOKIE.length + 1);
    if (current === value) return;
    document.cookie = `${LAST_VIEW_COOKIE}=${value}; path=/handouts; max-age=${60 * 60 * 24 * 180}; samesite=lax`;
  }, [p.query, p.userId]);

  // Search: 300 ms after the last key.
  useEffect(() => {
    if (q === (p.values.q ?? '')) return;
    const t = setTimeout(() => go({ q: q.trim() }), 300);
    return () => clearTimeout(t);
  }, [q]);

  // Suggestions (courses + people) after 2 characters, 300 ms debounce, inside the user's scope.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setSuggestions([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/handouts/suggest?q=${encodeURIComponent(term)}`, {
          signal: ctrl.signal,
        });
        if (!r.ok) return;
        const body = (await r.json()) as {
          courses: { code: string; title: string }[];
          people: { id: string | null; name: string; role: string }[];
        };
        setSuggestions([
          ...body.courses.map((c) => ({
            key: `c-${c.code}`,
            label: c.code,
            hint: c.title,
            apply: { q: c.code },
          })),
          ...body.people.map((x) => ({
            key: `p-${x.role}-${x.id ?? x.name}`,
            label: x.name,
            hint: x.role,
            apply:
              x.id && p.showPeople
                ? { [x.role === 'Faculty' ? 'faculty' : 'sme']: x.id, q: '' }
                : { q: x.name },
          })),
        ]);
        setActive(-1);
      } catch {
        /* aborted or offline: no suggestions */
      }
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, p.showPeople]);

  // "/" jumps to search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
        e.preventDefault();
        setOpen(true);
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const pick = (s: Suggestion) => {
    setShowList(false);
    setQ(s.apply.q ?? '');
    go(s.apply);
  };

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showList || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (a + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (a <= 0 ? suggestions.length - 1 : a - 1));
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      pick(suggestions[active]!);
    } else if (e.key === 'Escape') {
      setShowList(false);
    }
  };

  const v = (k: string) => p.values[k] ?? '';

  const select = (
    name: FilterKey,
    label: string,
    options: Facet[] | undefined,
    all: string,
    value = v(name),
    extra: Record<string, string> = {},
  ) => (
    <div>
      <label htmlFor={`f-${name}`} className={labelCls}>
        {label}
      </label>
      <select
        id={`f-${name}`}
        className={fieldCls}
        value={value}
        onChange={(e) =>
          go({
            // An explicit "current semester" overrides a quick view that looks at all semesters.
            [name]: name === 'term' && !e.target.value && hmpTab ? 'current' : e.target.value,
            ...extra,
          })
        }
        data-testid={`filter-${name}`}
      >
        <option value="">{all}</option>
        {(options ?? []).map((o) => (
          <option key={o.value} value={o.value} disabled={o.count === 0 && o.value !== value}>
            {o.label}
            {count(o.count)}
          </option>
        ))}
      </select>
    </div>
  );

  const range = (from: FilterKey, to: FilterKey, label: string) => (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1">
      <div>
        <label htmlFor={`f-${from}`} className="text-muted-foreground mb-1 block text-xs">
          {label} from
        </label>
        <input
          id={`f-${from}`}
          type="date"
          className={fieldCls}
          value={v(from)}
          onChange={(e) => go({ [from]: e.target.value })}
        />
      </div>
      <div>
        <label htmlFor={`f-${to}`} className="text-muted-foreground mb-1 block text-xs">
          to
        </label>
        <input
          id={`f-${to}`}
          type="date"
          className={fieldCls}
          value={v(to)}
          onChange={(e) => go({ [to]: e.target.value })}
        />
      </div>
    </div>
  );

  const anySet = (...ks: FilterKey[]) => ks.some((k) => v(k));
  const section = (title: string, openIf: boolean, children: React.ReactNode, testId: string) => (
    <details className="group border-t pt-3" open={openIf} data-testid={testId}>
      <summary className="cursor-pointer list-none text-sm font-semibold">
        <span className="text-muted-foreground mr-1 inline-block transition-transform group-open:rotate-90">
          ›
        </span>
        {title}
      </summary>
      <div className="mt-3 space-y-3">{children}</div>
    </details>
  );

  const hmpTab = p.tab !== 'past';
  const termOptions: Facet[] = [
    { value: 'all', label: 'All semesters', count: null },
    ...(p.facets.term ?? []),
  ];
  const termValue = v('term') || p.effectiveTerm;
  const currentLabel = `Current semester${p.currentTermName ? ` (${p.currentTermName})` : ''}`;
  const statusOptions = p.facets.status ?? [];

  return (
    <div className="h-fit">
      <button
        type="button"
        className="bg-background hover:bg-accent mb-2 inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium lg:hidden"
        aria-expanded={open}
        aria-controls="library-filter-panel"
        onClick={() => setOpen((o) => !o)}
        data-testid="filters-toggle"
      >
        Filters{p.activeCount > 0 ? ` (${p.activeCount})` : ''}
      </button>
      <div
        id="library-filter-panel"
        className={`${open ? 'block' : 'hidden'} bg-card rounded-lg border p-4 lg:block`}
        role="search"
        aria-label="Filter the library"
        data-testid="filter-panel"
      >
        <div className="space-y-4">
          <div className="relative">
            <label htmlFor="f-q" className={labelCls}>
              Search
            </label>
            <input
              id="f-q"
              ref={searchRef}
              type="search"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setShowList(true);
              }}
              onKeyDown={onSearchKey}
              onFocus={() => setShowList(true)}
              onBlur={() => setTimeout(() => setShowList(false), 150)}
              placeholder="Search course, title or person"
              className={fieldCls}
              role="combobox"
              aria-expanded={showList && suggestions.length > 0}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
              aria-describedby="f-q-hint"
              autoComplete="off"
              data-testid="library-search"
            />
            {showList && suggestions.length > 0 && (
              <ul
                id={listId}
                role="listbox"
                className="bg-popover absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-md border text-sm shadow-md"
                data-testid="search-suggestions"
              >
                {suggestions.map((s, i) => (
                  <li
                    key={s.key}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === active}
                    className={`cursor-pointer px-3 py-1.5 ${i === active ? 'bg-accent' : 'hover:bg-accent'}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pick(s);
                    }}
                  >
                    <span className="font-medium">{s.label}</span>{' '}
                    <span className="text-muted-foreground text-xs">{s.hint}</span>
                  </li>
                ))}
              </ul>
            )}
            <p id="f-q-hint" className="text-muted-foreground mt-1 text-xs">
              Press <kbd className="rounded border px-1">/</kbd> to search. “ss zg 653” finds SS
              ZG653.
            </p>
          </div>

          {select(
            'term',
            'Semester',
            termOptions.filter((o) => o.value !== 'current' && o.value !== p.currentTerm),
            hmpTab ? currentLabel : 'All semesters',
            termValue === (hmpTab ? 'current' : 'all') || termValue === p.currentTerm
              ? ''
              : termValue,
            {},
          )}
          {hmpTab && select('programme', 'Programme', p.facets.programme, 'All programmes')}
          {select('discipline', 'Discipline', p.facets.discipline, 'All disciplines')}

          {hmpTab && (
            <fieldset data-testid="filter-status">
              <legend className={labelCls}>Status</legend>
              <div className="space-y-0.5 text-sm">
                {[
                  { value: '', label: 'Any status', count: null, dot: undefined } as Facet,
                  ...statusOptions,
                ].map((o) => {
                  const checked = v('status') === o.value;
                  const disabled = o.count === 0 && !checked;
                  return (
                    <label
                      key={o.value || 'any'}
                      className={`flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 ${
                        disabled ? 'opacity-50' : 'hover:bg-accent'
                      }`}
                    >
                      <input
                        type="radio"
                        name="status"
                        value={o.value}
                        checked={checked}
                        disabled={disabled}
                        onChange={() => go({ status: o.value })}
                        className="sr-only"
                      />
                      <span
                        aria-hidden
                        className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
                          checked ? 'ring-2 ring-[var(--bits-navy)] ring-offset-1' : ''
                        }`}
                        style={{
                          background: o.dot ?? 'transparent',
                          border: o.dot ? 0 : '1px solid #999',
                        }}
                      />
                      <span className={checked ? 'font-semibold' : ''}>
                        {o.label}
                        <span className="text-muted-foreground tabular-nums">{count(o.count)}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}

          {hmpTab &&
            p.showPeople &&
            section(
              'People',
              anySet('faculty', 'sme', 'by'),
              <>
                {select('faculty', 'Faculty', p.facets.faculty, 'Anyone')}
                {select('sme', 'Subject expert', p.facets.sme, 'Anyone')}
                {select('by', 'Allocated by', p.facets.by, 'Anyone')}
              </>,
              'filter-section-people',
            )}

          {hmpTab &&
            section(
              'Dates',
              anySet(
                'due',
                'dueFrom',
                'dueTo',
                'updated',
                'updatedFrom',
                'updatedTo',
                'published',
                'publishedFrom',
                'publishedTo',
              ),
              <>
                {p.tab === 'in-progress' && (
                  <>
                    {select('due', 'Deadline', p.facets.due, 'Any deadline')}
                    {range('dueFrom', 'dueTo', 'Due')}
                  </>
                )}
                {select('updated', 'Last updated', p.facets.updated, 'Any time')}
                {range('updatedFrom', 'updatedTo', 'Updated')}
                {p.tab === 'published' && (
                  <>
                    {select('published', 'Published', p.facets.published, 'Any time')}
                    {range('publishedFrom', 'publishedTo', 'Published')}
                  </>
                )}
              </>,
              'filter-section-dates',
            )}

          {hmpTab &&
            section(
              'Schedule (Course Dibba)',
              anySet('slot', 'day', 'session', 'ctype', 'sched'),
              <>
                {select('slot', 'Slot', p.facets.slot, 'Any slot')}
                {select('day', 'Day', p.facets.day, 'Any day')}
                {select('session', 'Session', p.facets.session, 'Any session')}
                {select('ctype', 'Course type', p.facets.ctype, 'Any type')}
                {select('sched', 'In the schedule', p.facets.sched, 'Either')}
              </>,
              'filter-section-schedule',
            )}

          {hmpTab &&
            section(
              p.tab === 'published' ? 'Taxila and review history' : 'Review history',
              anySet('taxila', 'sentback', 'changed'),
              <>
                {p.tab === 'published' &&
                  select('taxila', 'Published to Taxila', p.facets.taxila, 'Either')}
                {select(
                  'sentback',
                  'Sent back for changes',
                  p.facets.sentback,
                  'Any number of times',
                )}
                {select('changed', 'Changed vs last year', p.facets.changed, 'Any amount')}
                {!p.changeComputed && (
                  <p className="text-muted-foreground text-xs">
                    Worked out when you pick an option (it compares each handout with last year’s).
                  </p>
                )}
              </>,
              'filter-section-review',
            )}
        </div>
      </div>
    </div>
  );
}

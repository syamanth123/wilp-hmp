'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export interface FacetOption {
  value: string;
  label: string;
  count: number;
}

interface Props {
  q: string;
  term: string;
  programme: string;
  status: string;
  /** Hidden for the past-handouts tab (those carry no HMP status / programme). */
  showHmpFilters: boolean;
  terms: FacetOption[];
  programmes: FacetOption[];
  statuses: FacetOption[];
}

const labelCls = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground';
const fieldCls =
  'h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

/**
 * The library's filter panel. Every change updates the address straight away (no Apply button),
 * so a view can be bookmarked or shared; the server does all filtering inside the user's scope.
 */
export function LibraryFilters(p: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(p.q);
  const [, startTransition] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);

  const go = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params?.toString() ?? '');
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete('page');
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  // Search: 300 ms after the last key.
  useEffect(() => {
    if (q === p.q) return;
    const t = setTimeout(() => go({ q: q.trim() }), 300);
    return () => clearTimeout(t);
  }, [q]);

  // "/" jumps to search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const select = (
    name: string,
    label: string,
    value: string,
    options: FacetOption[],
    all: string,
  ) => (
    <div>
      <label htmlFor={`f-${name}`} className={labelCls}>
        {label}
      </label>
      <select
        id={`f-${name}`}
        className={fieldCls}
        value={value}
        onChange={(e) => go({ [name]: e.target.value, view: '' })}
      >
        <option value="">{all}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.count === 0 && o.value !== value}>
            {o.label} ({o.count})
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="space-y-4" role="search">
      <div>
        <label htmlFor="f-q" className={labelCls}>
          Search
        </label>
        <input
          id="f-q"
          ref={searchRef}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Course code, title, faculty, HMP ref…"
          className={fieldCls}
          aria-describedby="f-q-hint"
        />
        <p id="f-q-hint" className="text-muted-foreground mt-1 text-xs">
          Press <kbd className="rounded border px-1">/</kbd> to search. “ss zg 653” finds SS ZG653.
        </p>
      </div>
      {p.showHmpFilters && (
        <>
          {select(
            'term',
            'Semester',
            p.term,
            [
              {
                value: 'all',
                label: 'All semesters',
                count: p.terms.reduce((n, t) => n + t.count, 0),
              },
              ...p.terms,
            ],
            'Same as the quick view',
          )}
          {select('programme', 'Programme', p.programme, p.programmes, 'All programmes')}
          {select('status', 'Status', p.status, p.statuses, 'All statuses')}
        </>
      )}
    </div>
  );
}

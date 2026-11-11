'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { Button } from '@hmp/ui';
import type { KickoffRow } from '@/lib/kickoff';
import { kickoffCreateAction, type KickoffResult } from './actions';

/** v1.4.2 — tick the courses, check the preview, create the requests (each to its department's HOG). */
export function KickoffList({
  term,
  termText,
  rows,
}: {
  term: string;
  termText: string;
  rows: KickoffRow[];
}) {
  const ready = rows.filter((r) => !r.problem);
  const [ticked, setTicked] = useState<Set<string>>(new Set(ready.map((r) => r.key)));
  const [result, setResult] = useState<KickoffResult | null>(null);
  const [pending, start] = useTransition();
  const groups = useMemo(() => {
    const m = new Map<string, KickoffRow[]>();
    for (const r of rows) {
      const k = r.departmentName ?? 'Department not known';
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return [...m.entries()];
  }, [rows]);
  const toggle = (key: string) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (result?.ok)
    return (
      <div
        className="space-y-2 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm"
        role="status"
      >
        <p>
          <strong>{result.created} requests created</strong> for {termText}, each sent to its
          department&apos;s HOG.
        </p>
        <p className="font-mono text-xs">{result.refNos.join(' · ')}</p>
        {result.notes.length ? <p className="text-amber-900">{result.notes.join(' · ')}</p> : null}
        <Link href="/ic/requests" className="underline">
          Open the requests
        </Link>
      </div>
    );

  return (
    <div className="space-y-4" data-testid="kickoff-list">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-white/70 px-3 py-2 text-sm">
        <span>
          <strong>{ticked.size}</strong> of {ready.length} ready courses ticked
          {rows.length > ready.length ? ` · ${rows.length - ready.length} need fixing first` : ''}
        </span>
        <span className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setTicked(new Set(ready.map((r) => r.key)))}
          >
            Tick all ready
          </Button>
          <Button size="sm" variant="outline" onClick={() => setTicked(new Set())}>
            Untick all
          </Button>
          <Button
            size="sm"
            disabled={pending || ticked.size === 0}
            onClick={() =>
              start(async () => setResult(await kickoffCreateAction(term, [...ticked])))
            }
            data-testid="kickoff-create"
          >
            {pending ? 'Creating…' : `Create ${ticked.size} request${ticked.size === 1 ? '' : 's'}`}
          </Button>
        </span>
      </div>
      {result && !result.ok ? (
        <p className="text-destructive text-sm" role="alert">
          {result.error}
        </p>
      ) : null}
      {groups.map(([dept, list]) => (
        <section key={dept} className="space-y-1">
          <h3 className="text-sm font-semibold">
            {dept}{' '}
            <span className="text-muted-foreground font-normal">
              · HOG {list[0]?.hogName ?? '—'} · {list.length} course{list.length === 1 ? '' : 's'}
            </span>
          </h3>
          <div className="overflow-x-auto rounded-md border bg-white/70">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left text-xs">
                  <th className="w-8 py-1.5 pl-3" />
                  <th className="py-1.5 pr-3 font-medium">Course</th>
                  <th className="py-1.5 pr-3 font-medium">HMP semester</th>
                  <th className="py-1.5 pr-3 font-medium">Due: allocation · draft · publish</th>
                  <th className="py-1.5 pr-3 font-medium">Starts from</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr
                    key={r.key}
                    className="border-b align-top last:border-0"
                    data-testid="kickoff-row"
                  >
                    <td className="py-2 pl-3">
                      <input
                        type="checkbox"
                        aria-label={`Start ${r.courseCode}`}
                        checked={!r.problem && ticked.has(r.key)}
                        disabled={!!r.problem}
                        onChange={() => toggle(r.key)}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <div className="font-medium">
                        {r.codes.join(' / ')} — {r.title}
                      </div>
                      <div className="text-muted-foreground text-xs">
                        Dibba: {r.dibbaProgrammes.join(', ')}
                      </div>
                      {r.problem ? (
                        <div className="mt-1 text-xs text-red-800" data-testid="kickoff-problem">
                          {r.problem.text}{' '}
                          <Link href={r.problem.fixHref} className="underline">
                            {r.problem.fixLabel}
                          </Link>
                        </div>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3">
                      {r.semesterName ? `${r.programmeCode} · ${r.semesterName}` : '—'}
                    </td>
                    <td className="py-2 pr-3 tabular-nums">
                      {r.due ? `${r.due.allocation} · ${r.due.draft} · ${r.due.publish}` : '—'}
                    </td>
                    <td className="py-2 pr-3">{r.start}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

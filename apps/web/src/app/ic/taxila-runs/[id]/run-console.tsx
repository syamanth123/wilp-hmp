'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@hmp/ui';
import type { ItemStatus, RunRow } from '@/lib/taxila-runs';
import { retryProblemsAction, runStepAction } from '../actions';

const LABEL: Record<ItemStatus, string> = {
  PENDING: 'Waiting',
  WORKING: 'Working…',
  READY: 'Ready to publish',
  PUBLISHED: 'Published',
  ALREADY_THERE: 'Already in Taxila',
  NOT_FOUND: 'Course not found',
  AMBIGUOUS: 'Several courses match',
  FOLDER_MISSING: 'Folder missing',
  FAILED: 'Failed',
  SKIPPED: 'Skipped',
};
const TONE: Record<ItemStatus, string> = {
  PENDING: 'bg-gray-100 text-gray-700',
  WORKING: 'bg-blue-100 text-blue-800',
  READY: 'bg-emerald-50 text-emerald-800',
  PUBLISHED: 'bg-emerald-100 text-emerald-900',
  ALREADY_THERE: 'bg-amber-100 text-amber-900',
  NOT_FOUND: 'bg-red-100 text-red-900',
  AMBIGUOUS: 'bg-red-100 text-red-900',
  FOLDER_MISSING: 'bg-red-100 text-red-900',
  FAILED: 'bg-red-100 text-red-900',
  SKIPPED: 'bg-gray-100 text-gray-700',
};
const PROBLEM: ItemStatus[] = ['NOT_FOUND', 'AMBIGUOUS', 'FOLDER_MISSING', 'FAILED'];
/** A pause between courses so Taxila isn't hammered. */
const BETWEEN_MS = 1_000;

/**
 * Drives a bulk run from the browser, one course at a time. Every result is saved on the server,
 * so Pause — or closing the tab — loses nothing; the run continues where it stopped.
 */
export function RunConsole({ runId, initialRows }: { runId: string; initialRows: RunRow[] }) {
  const [rows, setRows] = useState(initialRows);
  const [running, setRunning] = useState<null | 'check' | 'publish'>(null);
  const [error, setError] = useState<string | null>(null);
  const stop = useRef(false);
  useEffect(
    () => () => {
      stop.current = true;
    },
    [],
  );

  const count = (s: ItemStatus[]) => rows.filter((r) => s.includes(r.status)).length;
  const waiting = count(['PENDING', 'WORKING']);
  const ready = count(['READY']);
  const done = rows.length - waiting - ready;

  const go = async (mode: 'check' | 'publish') => {
    setError(null);
    stop.current = false;
    setRunning(mode);
    try {
      for (;;) {
        if (stop.current) break;
        const r = await runStepAction(runId, mode);
        if ('error' in r) {
          setError(r.error ?? 'Something went wrong.');
          break;
        }
        setRows(r.rows);
        if (r.done) break;
        await new Promise((res) => setTimeout(res, BETWEEN_MS));
      }
    } catch {
      setError('Lost touch with HMP. Nothing is lost — press the button again to carry on.');
    } finally {
      setRunning(null);
    }
  };

  const retry = async () => {
    const r = await retryProblemsAction(runId);
    setRows(r.rows);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          onClick={() => go('check')}
          disabled={!!running || count(['PENDING']) === 0}
          data-testid="run-check-all"
        >
          {running === 'check' ? 'Checking…' : 'Check all (no upload)'}
        </Button>
        <Button
          onClick={() => go('publish')}
          disabled={!!running || waiting + ready === 0}
          data-testid="run-publish-all"
        >
          {running === 'publish' ? 'Publishing…' : 'Publish all'}
        </Button>
        {running && (
          <Button variant="outline" onClick={() => (stop.current = true)} data-testid="run-pause">
            Pause
          </Button>
        )}
        {!running && count(PROBLEM) > 0 && (
          <Button variant="outline" onClick={retry} data-testid="run-retry">
            Try the {count(PROBLEM)} problem course{count(PROBLEM) === 1 ? '' : 's'} again
          </Button>
        )}
        <a
          href={`/api/taxila-runs/${runId}/report`}
          className="hover:bg-accent inline-flex items-center rounded-md border px-3 py-2 text-sm font-medium"
          data-testid="run-excel"
          download
        >
          Download as Excel
        </a>
      </div>

      <p className="text-sm" data-testid="run-progress" aria-live="polite">
        <strong>{done}</strong> of {rows.length} done
        {ready > 0 && <> · {ready} ready to publish</>} · {count(['PUBLISHED'])} published ·{' '}
        {count(['ALREADY_THERE'])} already there · {count(PROBLEM)} need attention
        {running && <> · working…</>}
      </p>
      {error && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="text-muted-foreground text-left text-xs uppercase tracking-wide">
            <tr className="border-b">
              <th className="px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">Course</th>
              <th className="px-3 py-2 font-medium">Result</th>
              <th className="px-3 py-2 font-medium">Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                className="border-b last:border-0"
                data-testid="run-row"
                data-status={r.status}
              >
                <td className="text-muted-foreground px-3 py-2 tabular-nums">{r.position}</td>
                <td className="px-3 py-2">
                  <div className="font-medium">{r.codes.join(' / ')}</div>
                  <div className="text-muted-foreground text-xs">
                    {r.courseTitle} · {r.refNo}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE[r.status]}`}
                  >
                    {LABEL[r.status]}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs">
                  {r.courseFullname && <div>{r.courseFullname}</div>}
                  {r.fileName && <div className="font-mono">{r.fileName}</div>}
                  {r.message && r.status !== 'PUBLISHED' && r.status !== 'READY' && (
                    <div className="text-muted-foreground">{r.message}</div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

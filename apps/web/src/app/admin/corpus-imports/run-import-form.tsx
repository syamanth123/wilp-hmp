'use client';

import { useState, useTransition } from 'react';
import { Button } from '@hmp/ui';
import { runCorpusImportAction } from './actions';

interface Props {
  defaultPath: string;
}

interface Summary {
  scanned: number;
  succeeded: number;
  failed: number;
  skippedSize: number;
  skippedFormat: number;
  skippedModule: number;
  unchanged: number;
  durationMs: number;
}

/**
 * Trigger-and-report widget for the corpus import. Admin-only. Inline
 * execution (not queued) per the 11f-a plan; admin tab sits during the run
 * (~20-60s for 384 files). Approval workflow (bulk approve / reject) lands
 * in 11f-b — this widget ships the import-and-report only.
 */
export function RunImportForm({ defaultPath }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [corpusPath, setCorpusPath] = useState(defaultPath);
  const [limit, setLimit] = useState('');

  const run = () => {
    setError(null);
    setSummary(null);
    const fd = new FormData();
    fd.set('corpusPath', corpusPath);
    if (limit) fd.set('limit', limit);
    startTransition(async () => {
      const r = await runCorpusImportAction(fd);
      if ('error' in r && r.error) setError(r.error);
      else if (r.ok) setSummary(r.summary);
    });
  };

  return (
    <div className="space-y-3" data-testid="corpus-import-form">
      <div className="grid gap-3 md:grid-cols-[1fr_120px_auto]">
        <label className="grid gap-1">
          <span className="text-muted-foreground text-xs">Corpus directory (server path)</span>
          <input
            type="text"
            value={corpusPath}
            onChange={(e) => setCorpusPath(e.target.value)}
            disabled={pending}
            className="bg-background rounded-md border px-3 py-2 font-mono text-sm"
            data-testid="corpus-import-path"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-muted-foreground text-xs">Limit (optional)</span>
          <input
            type="text"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            disabled={pending}
            placeholder="all"
            className="bg-background rounded-md border px-3 py-2 text-sm"
            data-testid="corpus-import-limit"
          />
        </label>
        <Button onClick={run} disabled={pending || !corpusPath.trim()} className="self-end">
          {pending ? 'Importing…' : 'Run import'}
        </Button>
      </div>

      {error && (
        <p className="text-destructive text-sm" data-testid="corpus-import-error">
          {error}
        </p>
      )}

      {summary && (
        <div
          className="grid grid-cols-2 gap-2 rounded-md border bg-emerald-50 p-3 text-sm md:grid-cols-4"
          data-testid="corpus-import-summary"
        >
          <Cell label="Scanned" value={summary.scanned} />
          <Cell label="Succeeded" value={summary.succeeded} tone="success" />
          <Cell
            label="Failed"
            value={summary.failed}
            tone={summary.failed > 0 ? 'warning' : undefined}
          />
          <Cell label="Unchanged (idempotent)" value={summary.unchanged} />
          <Cell label="Skipped (size >3MB)" value={summary.skippedSize} />
          <Cell label="Skipped (format .doc/.pdf)" value={summary.skippedFormat} />
          <Cell label="Skipped (Module template)" value={summary.skippedModule} />
          <Cell label="Duration" value={`${(summary.durationMs / 1000).toFixed(1)}s`} />
        </div>
      )}
    </div>
  );
}

function Cell({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: 'success' | 'warning';
}) {
  const color =
    tone === 'success'
      ? 'text-emerald-700'
      : tone === 'warning'
        ? 'text-amber-700'
        : 'text-slate-700';
  return (
    <div>
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className={`font-mono text-sm font-semibold ${color}`}>{value}</p>
    </div>
  );
}

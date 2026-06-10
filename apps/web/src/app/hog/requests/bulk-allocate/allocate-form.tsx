'use client';

import { useState, useTransition } from 'react';
import { Button } from '@hmp/ui';
import { bulkAllocateAction } from './actions';
import type { BulkAllocateResult } from './bulk-allocate';

export function BulkAllocateForm() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<BulkAllocateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    setResult(null);
    if (!file) {
      setError('Choose a .csv file first.');
      return;
    }
    startTransition(async () => {
      const text = await file.text();
      const fd = new FormData();
      fd.set('csv', text);
      setResult(await bulkAllocateAction(fd));
    });
  };

  const downloadRejected = (csv: string) => {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rejected-rows.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setResult(null);
            setError(null);
          }}
          className="text-sm"
          data-testid="bulk-csv-file"
        />
        <Button onClick={submit} disabled={pending || !file} data-testid="bulk-process-button">
          {pending ? 'Processing…' : 'Process upload'}
        </Button>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}

      {result?.status === 'success' && (
        <div className="space-y-2" data-testid="bulk-success">
          <p className="text-sm text-emerald-600">
            Allocated {result.allocated} request{result.allocated === 1 ? '' : 's'} (status
            ALLOCATED).
          </p>
          <RefNoList refNos={result.refNos} />
        </div>
      )}

      {result?.status === 'partial' && (
        <div className="space-y-2" data-testid="bulk-partial">
          <p className="text-sm text-emerald-600">
            Allocated {result.allocated} request{result.allocated === 1 ? '' : 's'}.
          </p>
          <RefNoList refNos={result.refNos} />
          <div className="rounded-md border p-3" style={{ borderColor: 'var(--warn)' }}>
            <p className="text-sm font-medium">
              {result.failed.length} request{result.failed.length === 1 ? '' : 's'} could not be
              allocated
            </p>
            <p className="text-muted-foreground text-xs">
              These failed at the transition step (e.g. a concurrent status change). The others
              committed. Re-upload just these rows.
            </p>
            <ul className="mt-1 text-xs">
              {result.failed.map((f) => (
                <li key={f.refNo} className="font-mono">
                  {f.refNo} — {f.reason}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {result?.status === 'rejected' && (
        <div className="space-y-3" data-testid="bulk-rejected">
          <p className="text-destructive text-sm font-medium">
            Upload rejected — {result.errors.length} problem
            {result.errors.length === 1 ? '' : 's'} found. Nothing was allocated. Fix the rows below
            and re-upload the whole file.
          </p>
          <ol className="space-y-1 text-sm">
            {result.errors.map((e, i) => (
              <li key={i} className="rounded-md border p-2">
                <span className="font-mono text-xs">line {e.line}</span>{' '}
                <span className="text-muted-foreground text-xs">[{e.code}]</span>
                {e.field ? (
                  <span className="text-muted-foreground text-xs"> · {e.field}</span>
                ) : null}
                <div>{e.message}</div>
              </li>
            ))}
          </ol>
          <Button
            variant="outline"
            size="sm"
            onClick={() => downloadRejected(result.rejectedCsv)}
            data-testid="bulk-download-rejected"
          >
            Download rejected rows (CSV)
          </Button>
        </div>
      )}
    </div>
  );
}

function RefNoList({ refNos }: { refNos: string[] }) {
  if (refNos.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2" data-testid="bulk-refnos">
      {refNos.map((r) => (
        <li key={r} className="rounded-md border px-2 py-0.5 font-mono text-xs">
          {r}
        </li>
      ))}
    </ul>
  );
}

'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@hmp/ui';
import type { Preview, RowStatus } from '@/lib/people-import';
import { applyPeopleAction, previewPeopleAction } from '../actions';

const LABEL: Record<RowStatus, string> = {
  new: 'New',
  changed: 'Changed',
  unchanged: 'Unchanged',
  error: 'Error',
};
const TONE: Record<RowStatus, string> = {
  new: 'bg-emerald-100 text-emerald-900',
  changed: 'bg-blue-100 text-blue-900',
  unchanged: 'bg-gray-100 text-gray-700',
  error: 'bg-red-100 text-red-900',
};
const ROLE_SHORT: Record<string, string> = {
  ADMIN: 'Admin',
  INSTRUCTION_CELL: 'IC',
  HOG: 'HOG',
  PROGRAMME_COMMITTEE: 'PC',
  FACULTY: 'Faculty',
  SME: 'SME',
};

/** Upload people (v1.4 §B): preview every row first; nothing is saved until Apply. */
export function UploadPeople() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const form = () => {
    const fd = new FormData();
    fd.set('file', file!);
    return fd;
  };
  const check = () =>
    startTransition(async () => {
      setMessage(null);
      setPreview(await previewPeopleAction(form()));
    });
  const apply = () =>
    startTransition(async () => {
      const r = await applyPeopleAction(form());
      if (r.ok) {
        setMessage(`Saved: ${r.created} added, ${r.changed} changed.`);
        setPreview(null);
        router.refresh();
      } else {
        setMessage(r.error);
        if (r.preview) setPreview(r.preview);
      }
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="file"
          accept=".csv,.xlsx,text/csv"
          aria-label="People file (CSV or Excel)"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setPreview(null);
          }}
          className="text-sm"
          data-testid="people-file"
        />
        <Button onClick={check} disabled={!file || pending} data-testid="people-preview">
          {pending && !preview ? 'Checking…' : 'Check the file'}
        </Button>
      </div>
      {message && (
        <p className="text-sm font-medium" role="status" data-testid="people-message">
          {message}
        </p>
      )}
      {preview?.fileError && (
        <p className="text-destructive text-sm" role="alert">
          {preview.fileError}
        </p>
      )}
      {preview && !preview.fileError && (
        <div className="space-y-3" data-testid="people-preview-table">
          <p className="text-sm">
            <strong>{preview.counts.new}</strong> new · <strong>{preview.counts.changed}</strong>{' '}
            changed · {preview.counts.unchanged} unchanged ·{' '}
            <strong className={preview.counts.error ? 'text-red-700' : ''}>
              {preview.counts.error} with errors
            </strong>
            {preview.counts.error > 0 &&
              ' — fix those rows and check again; nothing is saved while there are errors.'}
          </p>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground text-left text-xs uppercase tracking-wide">
                <tr className="border-b">
                  <th className="px-3 py-2 font-medium">Row</th>
                  <th className="px-3 py-2 font-medium">Person</th>
                  <th className="px-3 py-2 font-medium">Roles</th>
                  <th className="px-3 py-2 font-medium">Department</th>
                  <th className="px-3 py-2 font-medium">Result</th>
                  <th className="px-3 py-2 font-medium">What happens</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.line} className="border-b last:border-0" data-status={r.status}>
                    <td className="text-muted-foreground px-3 py-2 tabular-nums">{r.line}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{r.name || '—'}</div>
                      <div className="text-muted-foreground font-mono text-xs">{r.email}</div>
                    </td>
                    <td className="px-3 py-2">
                      {r.roles.map((x) => ROLE_SHORT[x]).join(', ') || '—'}
                    </td>
                    <td className="px-3 py-2">{r.departmentName ?? '—'}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE[r.status]}`}
                      >
                        {LABEL[r.status]}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {r.status === 'error'
                        ? r.error
                        : r.status === 'new'
                          ? 'Account created; they sign in with their BITS ID'
                          : r.changes.join('; ') || 'Nothing to change'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button
            onClick={apply}
            disabled={
              pending ||
              preview.counts.error > 0 ||
              preview.counts.new + preview.counts.changed === 0
            }
            data-testid="people-apply"
          >
            {pending
              ? 'Saving…'
              : `Apply — add ${preview.counts.new}, change ${preview.counts.changed}`}
          </Button>
        </div>
      )}
    </div>
  );
}

'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@hmp/ui';
import type { Preview, PreviewRow, RowStatus } from '@/lib/people-import';
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

function WhatHappens({
  r,
  accepted,
  toggle,
}: {
  r: PreviewRow;
  accepted: boolean;
  toggle: () => void;
}) {
  if (r.status === 'error') return <>{r.error}</>;
  const base =
    r.status === 'new'
      ? 'Account created; they sign in with their BITS ID'
      : r.changes.join('; ') || (r.suggestion || r.note || r.warning ? '' : 'Nothing to change');
  return (
    <div className="space-y-1">
      {base && <div>{base}</div>}
      {r.suggestion && (
        <label
          className={`inline-flex cursor-pointer items-center gap-2 rounded border px-2 py-1 ${
            accepted
              ? 'border-emerald-300 bg-emerald-50 text-emerald-950'
              : 'border-amber-300 bg-amber-50 text-amber-950'
          }`}
          data-testid="people-suggestion"
        >
          <input
            type="checkbox"
            checked={accepted}
            onChange={toggle}
            aria-label={`Accept ${r.suggestion.departmentName} for ${r.email}`}
          />
          <span>
            Suggested: <strong>{r.suggestion.departmentName}</strong> (from {r.suggestion.courses}{' '}
            past course{r.suggestion.courses === 1 ? '' : 's'}) — accept?
          </span>
        </label>
      )}
      {r.warning && (
        <div className="font-medium text-amber-800" data-testid="people-warning">
          {r.warning}
        </div>
      )}
      {r.needsDecision && (
        <div className="font-medium text-amber-800" data-testid="people-needs-decision">
          {r.note}
        </div>
      )}
    </div>
  );
}

/**
 * Upload people (v1.4.0 §B, H6): preview every row first; nothing is saved until Apply. A person with
 * no department yet can stay blank: the preview suggests one from their past courses, saved only if
 * ticked ("Accept all suggestions" ticks them all).
 */
export function UploadPeople() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [accepted, setAccepted] = useState<Set<number>>(new Set());
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
      setAccepted(new Set());
      setPreview(await previewPeopleAction(form()));
    });
  const apply = () =>
    startTransition(async () => {
      const fd = form();
      fd.set('accept', JSON.stringify([...accepted]));
      const r = await applyPeopleAction(fd);
      if (r.ok) {
        setMessage(
          `Saved: ${r.created} added, ${r.changed} changed` +
            (r.accepted
              ? ` (${r.accepted} suggested department${r.accepted === 1 ? '' : 's'} accepted).`
              : '.'),
        );
        setPreview(null);
        setAccepted(new Set());
        router.refresh();
      } else {
        setMessage(r.error);
        if (r.preview) setPreview(r.preview);
      }
    });

  const suggestionLines = preview?.rows.filter((r) => r.suggestion).map((r) => r.line) ?? [];
  const toggle = (line: number) =>
    setAccepted((cur) => {
      const next = new Set(cur);
      if (next.has(line)) next.delete(line);
      else next.add(line);
      return next;
    });
  const allAccepted = suggestionLines.length > 0 && suggestionLines.every((l) => accepted.has(l));
  const toSave = preview ? preview.counts.new + preview.counts.changed + accepted.size : 0;

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
          <p className="text-sm" data-testid="people-counts">
            <strong>{preview.counts.new}</strong> new · <strong>{preview.counts.changed}</strong>{' '}
            changed · {preview.counts.unchanged} unchanged ·{' '}
            <strong className={preview.counts.error ? 'text-red-700' : ''}>
              {preview.counts.error} with errors
            </strong>
            {preview.counts.suggested > 0 && (
              <>
                {' '}
                · <strong>{preview.counts.suggested}</strong> suggested department
                {preview.counts.suggested === 1 ? '' : 's'} to check
              </>
            )}
            {preview.counts.needsDecision > 0 && (
              <>
                {' '}
                ·{' '}
                <strong className="text-amber-800">
                  {preview.counts.needsDecision} need a decision
                </strong>
              </>
            )}
            {preview.counts.error > 0 &&
              ' — fix those rows and check again; nothing is saved while there are errors.'}
          </p>
          {suggestionLines.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              <span>
                {suggestionLines.length}{' '}
                {suggestionLines.length === 1 ? 'person has' : 'people have'} no department yet, and
                their past courses all point to one. Nothing is saved unless you accept it.
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setAccepted(allAccepted ? new Set() : new Set(suggestionLines))}
                data-testid="people-accept-all"
              >
                {allAccepted
                  ? 'Untick all suggestions'
                  : `Accept all ${suggestionLines.length} suggestions`}
              </Button>
              <span className="text-xs">{accepted.size} accepted</span>
            </div>
          )}
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
                    <td className="px-3 py-2">
                      {r.departmentName ??
                        (r.suggestion && accepted.has(r.line) ? (
                          <span className="text-emerald-800">{r.suggestion.departmentName}</span>
                        ) : (
                          '—'
                        ))}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE[r.status]}`}
                      >
                        {LABEL[r.status]}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <WhatHappens
                        r={r}
                        accepted={accepted.has(r.line)}
                        toggle={() => toggle(r.line)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button
            onClick={apply}
            disabled={pending || preview.counts.error > 0 || toSave === 0}
            data-testid="people-apply"
          >
            {pending
              ? 'Saving…'
              : `Apply — add ${preview.counts.new}, change ${preview.counts.changed}` +
                (accepted.size
                  ? `, accept ${accepted.size} suggestion${accepted.size === 1 ? '' : 's'}`
                  : '')}
          </Button>
        </div>
      )}
    </div>
  );
}

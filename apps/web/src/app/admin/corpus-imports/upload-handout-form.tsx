'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@hmp/ui';

/**
 * Admin manual handout upload (Prompt 24). Posts a single .docx/.doc to the
 * upload Route Handler and renders a TRIAGE-grade result with three distinct
 * states — clean / imported-with-warnings / error — because admin uses this to
 * triage stubborn files and must know whether to approve. On success the grid
 * refreshes so the new row (unapproved) appears for review.
 */
interface UploadResult {
  ok?: boolean;
  importId?: string;
  extractionMethod?: string;
  hasData?: boolean;
  warnings?: string[];
  errors?: string[];
  bitsCourseNumber?: string | null;
  error?: string;
  detail?: string;
}

type State = 'clean' | 'warnings' | 'error';

function classify(res: UploadResult, httpOk: boolean): State {
  if (!httpOk || res.error) return 'error';
  if (!res.hasData || (res.warnings?.length ?? 0) > 0) return 'warnings';
  return 'clean';
}

export function UploadHandoutForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [state, setState] = useState<State | null>(null);
  const [res, setRes] = useState<UploadResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const file = inputRef.current?.files?.[0];
    if (!file) return;
    setState(null);
    setRes(null);
    const fd = new FormData();
    fd.set('file', file);
    start(async () => {
      const r = await fetch('/api/admin/corpus-imports/upload', { method: 'POST', body: fd });
      const json: UploadResult = await r.json().catch(() => ({ error: 'bad_response' }));
      setRes(json);
      setState(classify(json, r.ok));
      if (r.ok) router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="space-y-3" data-testid="upload-handout-form">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1">
          <span className="text-muted-foreground text-xs">Upload a handout (.docx or .doc)</span>
          <input
            ref={inputRef}
            type="file"
            accept=".docx,.doc"
            disabled={pending}
            data-testid="upload-file-input"
            className="text-sm"
          />
        </label>
        <Button type="submit" disabled={pending} data-testid="upload-submit">
          {pending ? 'Uploading…' : 'Upload handout'}
        </Button>
      </div>

      {state && res && (
        <div
          data-testid="upload-result"
          data-state={state}
          className={
            state === 'clean'
              ? 'rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800'
              : state === 'warnings'
                ? 'rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800'
                : 'rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800'
          }
        >
          {state === 'clean' && (
            <p>
              ✓ Imported <strong>{res.bitsCourseNumber ?? '(no course code)'}</strong> (
              {res.extractionMethod}, 0 warnings). Review it in the grid below, then approve.
            </p>
          )}
          {state === 'warnings' && (
            <p>
              ⚠ Imported{res.bitsCourseNumber ? ` ${res.bitsCourseNumber}` : ''} (
              {res.extractionMethod}) —{' '}
              {res.hasData
                ? `${res.warnings?.length ?? 0} warning(s); review before approving.`
                : 'no structured data extracted; review in the grid.'}
            </p>
          )}
          {state === 'error' && (
            <p>
              ✗ Upload failed: <strong>{res.error ?? 'unknown'}</strong>
              {res.detail ? ` — ${res.detail}` : ''}.
            </p>
          )}
        </div>
      )}
    </form>
  );
}

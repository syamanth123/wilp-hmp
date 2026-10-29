'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Label } from '@hmp/ui';
import {
  DIBBA_UPLOAD_MAX_MB,
  FACULTY_SHEET_ACCEPT_ATTR,
  validateFacultySheetUpload,
} from '../../../upload-validation';
import { uploadFailureMessage } from '@/lib/upload-errors';

interface UploadResponse {
  ok?: boolean;
  totalRows?: number;
  matched?: number;
  created?: number;
  alreadyManual?: number;
  noEmail?: number;
  noCourseCode?: number;
  unmatched?: Array<{ email: string; name: string; courseCode: string }>;
  error?: string;
  detail?: string;
}

function describeFailure(res: UploadResponse): string {
  return uploadFailureMessage(res.error, res.detail);
}

const fmt = new Intl.NumberFormat('en-IN');

/**
 * Faculty → course sheet upload (Phase 4, plan D6). Posts to the term's upload
 * Route Handler; the result (counts + unmatched emails) stays on screen until
 * the next upload, and the list below refreshes through the Router Cache.
 */
export function FacultySheetUploadForm({ termId }: { termId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<UploadResponse | null>(null);

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setDone(null);
    const file = inputRef.current?.files?.[0];
    if (!file) {
      setError('Choose a .xlsx or .csv file first.');
      return;
    }
    const v = validateFacultySheetUpload({ name: file.name, size: file.size });
    if (!v.ok) {
      setError(v.message);
      return;
    }
    const fd = new FormData();
    fd.set('file', file);
    start(async () => {
      const r = await fetch(`/api/ic/dibba-terms/${termId}/instructors/upload`, {
        method: 'POST',
        body: fd,
      });
      const json: UploadResponse = await r.json().catch(() => ({ error: 'bad_response' }));
      if (!r.ok || !json.ok) {
        setError(describeFailure(json));
        return;
      }
      setDone(json);
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="space-y-3" data-testid="dibba-faculty-upload-form">
      <div>
        <Label htmlFor="faculty-sheet-file">
          Faculty sheet (.xlsx with a &ldquo;Sheet3&rdquo; tab, or .csv with the same headers; max{' '}
          {DIBBA_UPLOAD_MAX_MB} MB)
        </Label>
        <input
          id="faculty-sheet-file"
          ref={inputRef}
          type="file"
          accept={FACULTY_SHEET_ACCEPT_ATTR}
          onChange={() => {
            setError(null);
            setDone(null);
          }}
          disabled={pending}
          className="block h-9 w-full text-sm"
          data-testid="dibba-faculty-file-input"
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending} data-testid="dibba-faculty-upload-submit">
          {pending ? 'Importing…' : 'Import sheet'}
        </Button>
        <span className="text-muted-foreground text-xs">
          Replaces the rows from the previous sheet; rows added by hand are kept. Nobody gets an
          account from this — unmatched emails are listed for an admin.
        </span>
      </div>
      {(error || done) && (
        <div
          data-testid="dibba-faculty-upload-result"
          data-state={error ? 'error' : 'ok'}
          role={error ? 'alert' : undefined}
          className={
            error
              ? 'rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800'
              : 'rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800'
          }
        >
          {error ? (
            <p>✗ Import failed: {error}</p>
          ) : (
            <div className="space-y-2">
              <p>
                ✓ Read {fmt.format(done?.totalRows ?? 0)} rows: {fmt.format(done?.matched ?? 0)}{' '}
                instructor rows matched an HMP account ({fmt.format(done?.created ?? 0)} written,{' '}
                {fmt.format(done?.alreadyManual ?? 0)} already added by hand);{' '}
                {fmt.format(done?.noEmail ?? 0)} rows had no email;{' '}
                {fmt.format(done?.noCourseCode ?? 0)} rows had no course code.
              </p>
              {done?.unmatched && done.unmatched.length > 0 ? (
                <div>
                  <p className="font-medium">
                    {fmt.format(done.unmatched.length)} email
                    {done.unmatched.length === 1 ? '' : 's'} without an active HMP account (ask an
                    admin to create them):
                  </p>
                  <ul className="mt-1 list-disc pl-5" data-testid="dibba-faculty-unmatched">
                    {done.unmatched.map((u) => (
                      <li key={`${u.email}|${u.courseCode}`}>
                        <span className="font-mono">{u.email}</span> — {u.name || 'no name'} ·{' '}
                        {u.courseCode}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p data-testid="dibba-faculty-unmatched" data-count="0">
                  Every email matched an account.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </form>
  );
}

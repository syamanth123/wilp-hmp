'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Label } from '@hmp/ui';
import {
  DIBBA_ACCEPT_ATTR,
  DIBBA_UPLOAD_MAX_MB,
  deriveDibbaLabel,
  validateDibbaUpload,
} from './upload-validation';

/**
 * IC Dibba upload (plan §1). Posts the file to the upload Route Handler (a
 * Route Handler, not a server action — see api/ic/dibba-imports/upload) and,
 * on success, refreshes the Router Cache (so this list is fresh on Back) and
 * opens the preview. The client-side validation is a courtesy; the handler's
 * check is the one that matters.
 */
interface UploadResponse {
  ok?: boolean;
  importId?: string;
  rowCount?: number;
  warningCount?: number;
  unknownCodeCount?: number;
  error?: string;
  detail?: string;
}

interface Props {
  terms: Array<{ id: string; name: string }>;
}

function describeFailure(res: UploadResponse, httpStatus: number): string {
  if (res.error === 'rate_limited') return 'Too many uploads in the last hour — try again later.';
  if (res.error === 'bad_response')
    return `The server returned an unexpected response (HTTP ${httpStatus}).`;
  const code = res.error ?? `http_${httpStatus}`;
  return res.detail ? `${code} — ${res.detail}` : code;
}

const fmt = new Intl.NumberFormat('en-IN');

export function UploadDibbaForm({ terms }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [termId, setTermId] = useState(terms[0]?.id ?? '');
  // `terms` changes under us when CreateTermForm's action revalidates /ic/dibba
  // (the server tree re-renders in place; this client component keeps its
  // state), so the mount-time id can be '' on a fresh DB or name a term that
  // is no longer first. Derive the live value every render: an explicit pick
  // wins while it exists, otherwise the first term — render-pure, no effect.
  const selectedTermId = terms.some((t) => t.id === termId) ? termId : (terms[0]?.id ?? '');
  const [label, setLabel] = useState('');
  const [labelEdited, setLabelEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<UploadResponse | null>(null);

  const onFileChange = () => {
    setError(null);
    setDone(null);
    const file = inputRef.current?.files?.[0];
    if (!file) return;
    if (!labelEdited) setLabel(deriveDibbaLabel(file.name));
    const v = validateDibbaUpload({ name: file.name, size: file.size });
    if (!v.ok) setError(v.message);
  };

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setDone(null);
    const file = inputRef.current?.files?.[0];
    if (!file) {
      setError('Choose a .doc, .docx or .xlsx file first.');
      return;
    }
    if (!selectedTermId) {
      setError('Create a term first, then upload the Dibba for it.');
      return;
    }
    const v = validateDibbaUpload({ name: file.name, size: file.size });
    if (!v.ok) {
      setError(v.message);
      return;
    }
    const fd = new FormData();
    fd.set('file', file);
    fd.set('termId', selectedTermId);
    fd.set('label', label.trim());
    start(async () => {
      const r = await fetch('/api/ic/dibba-imports/upload', { method: 'POST', body: fd });
      const json: UploadResponse = await r.json().catch(() => ({ error: 'bad_response' }));
      if (!r.ok || !json.ok || !json.importId) {
        setError(describeFailure(json, r.status));
        return;
      }
      setDone(json);
      router.refresh();
      router.push(`/ic/dibba/${json.importId}`);
    });
  };

  return (
    <form onSubmit={submit} className="space-y-3" data-testid="dibba-upload-form">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div>
          <Label htmlFor="dibba-term">Term</Label>
          <select
            id="dibba-term"
            name="termId"
            value={selectedTermId}
            onChange={(e) => setTermId(e.target.value)}
            disabled={pending || terms.length === 0}
            className="bg-background h-9 w-full rounded-md border px-2 text-sm"
            data-testid="dibba-term-select"
          >
            {terms.length === 0 && <option value="">No terms yet</option>}
            {terms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="dibba-file">
            Dibba file (.doc, .docx or .xlsx, max {DIBBA_UPLOAD_MAX_MB} MB)
          </Label>
          <input
            id="dibba-file"
            ref={inputRef}
            type="file"
            accept={DIBBA_ACCEPT_ATTR}
            onChange={onFileChange}
            disabled={pending}
            className="block h-9 w-full text-sm"
            data-testid="dibba-file-input"
          />
        </div>
        <div>
          <Label htmlFor="dibba-label">Label</Label>
          <Input
            id="dibba-label"
            name="label"
            value={label}
            placeholder="As on 02.07.2025"
            maxLength={120}
            onChange={(e) => {
              setLabel(e.target.value);
              setLabelEdited(true);
            }}
            disabled={pending}
            data-testid="dibba-label-input"
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          disabled={pending || terms.length === 0}
          data-testid="dibba-upload-submit"
        >
          {pending ? 'Uploading…' : 'Upload and preview'}
        </Button>
        <span className="text-muted-foreground text-xs">
          The file is parsed and stored as a draft; nothing is published until you confirm on the
          preview.
        </span>
      </div>
      {(error || done) && (
        <div
          data-testid="dibba-upload-result"
          data-state={error ? 'error' : 'ok'}
          role={error ? 'alert' : undefined}
          className={
            error
              ? 'rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800'
              : 'rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800'
          }
        >
          {error ? (
            <p>✗ Upload failed: {error}</p>
          ) : (
            <p>
              ✓ Parsed {fmt.format(done?.rowCount ?? 0)} rows
              {done?.warningCount ? ` with ${done.warningCount} warning(s)` : ''} — opening the
              preview…
            </p>
          )}
        </div>
      )}
    </form>
  );
}

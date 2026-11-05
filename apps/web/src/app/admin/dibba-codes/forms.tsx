'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@hmp/ui';
import type { CsvResult } from '@/lib/dibba-programme-codes';
import { setDibbaCodeAction, uploadDibbaCodesAction } from './actions';

export interface ProgrammeOption {
  id: string;
  code: string;
  name: string;
}

/** The HMP programme a Dibba code is linked to — saved as soon as it changes. */
export function CodeLinkSelect({
  code,
  linkedProgrammeId,
  programmes,
}: {
  code: string;
  linkedProgrammeId: string | null;
  programmes: ProgrammeOption[];
}) {
  const [value, setValue] = useState(linkedProgrammeId ?? '');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const change = (next: string) => {
    const previous = value;
    setValue(next);
    setMessage(null);
    const fd = new FormData();
    fd.set('code', code);
    fd.set('programmeId', next);
    startTransition(async () => {
      const r = await setDibbaCodeAction(fd);
      if (r.ok) setMessage({ ok: true, text: 'Saved' });
      else {
        setValue(previous);
        setMessage({ ok: false, text: r.error });
      }
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label={`HMP programme for ${code}`}
        className="bg-background h-8 rounded-md border px-2 text-sm"
        value={value}
        disabled={pending}
        onChange={(e) => change(e.target.value)}
        data-testid="dibba-code-select"
      >
        <option value="">Not linked</option>
        {programmes.map((p) => (
          <option key={p.id} value={p.id}>
            {p.code} — {p.name}
          </option>
        ))}
      </select>
      {pending && <span className="text-muted-foreground text-xs">Saving…</span>}
      {message && (
        <span
          role={message.ok ? 'status' : 'alert'}
          className={message.ok ? 'text-xs text-emerald-700' : 'text-destructive text-xs'}
        >
          {message.text}
        </span>
      )}
    </div>
  );
}

/** "Link to MTECH-SE" — one click, only when Admin presses it. */
export function SuggestLink({ code, programme }: { code: string; programme: ProgrammeOption }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <p
      className="text-muted-foreground mt-1 flex flex-wrap items-center gap-2 text-xs"
      data-testid="dibba-code-suggestion"
    >
      <span>
        Looks like <strong>{programme.code}</strong> — {programme.name}
      </span>
      <button
        type="button"
        className="hover:bg-accent rounded border px-2 py-0.5 font-medium text-[var(--bits-navy)]"
        disabled={pending}
        onClick={() => {
          setError(null);
          const fd = new FormData();
          fd.set('code', code);
          fd.set('programmeId', programme.id);
          startTransition(async () => {
            const r = await setDibbaCodeAction(fd);
            if (r.ok) router.refresh();
            else setError(r.error);
          });
        }}
        data-testid="dibba-code-suggestion-link"
      >
        {pending ? 'Linking…' : `Link to ${programme.code}`}
      </button>
      {error && <span className="text-destructive">{error}</span>}
    </p>
  );
}

/** CSV upload `code,programme_code`: everything is checked first; one bad row saves nothing. */
export function CodeCsvUpload() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<CsvResult | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    if (!file) return;
    setResult(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set('csv', await file.text());
      setResult(await uploadDibbaCodesAction(fd));
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="file"
          accept=".csv,text/csv"
          aria-label="CSV file of programme code links"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setResult(null);
          }}
          className="text-sm"
          data-testid="dibba-codes-file"
        />
        <Button onClick={submit} disabled={pending || !file} data-testid="dibba-codes-upload">
          {pending ? 'Checking…' : 'Upload links'}
        </Button>
      </div>
      {result?.ok && (
        <p className="text-sm text-emerald-700" role="status" data-testid="dibba-codes-result">
          Checked {result.rows} row{result.rows === 1 ? '' : 's'};{' '}
          {result.changed === 0
            ? 'everything was already linked that way.'
            : `${result.changed} link${result.changed === 1 ? '' : 's'} saved.`}
        </p>
      )}
      {result && !result.ok && (
        <div className="space-y-1 text-sm" role="alert" data-testid="dibba-codes-errors">
          <p className="text-destructive font-medium">
            Nothing was saved. Fix these rows and upload again:
          </p>
          <ol className="list-inside list-disc">
            {result.errors.map((e, i) => (
              <li key={i}>
                Row {e.line} — {e.message}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

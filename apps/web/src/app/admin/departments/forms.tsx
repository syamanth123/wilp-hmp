'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@hmp/ui';
import {
  acceptDibbaTitleSuggestionsAction,
  applyHogBackfillAction,
  saveDepartmentAction,
  setDibbaCodeDepartmentAction,
  setProgrammeDepartmentAction,
} from './actions';

const field = 'bg-background h-8 rounded-md border px-2 text-sm';

/** Add a department, or rename / switch one on or off. */
export function DepartmentEditor({
  dept,
}: {
  dept?: { id: string; code: string; name: string; active: boolean };
}) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState(dept?.code ?? '');
  const [name, setName] = useState(dept?.name ?? '');
  const [active, setActive] = useState(dept?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      setError(null);
      const r = await saveDepartmentAction({ id: dept?.id, code, name, active });
      if (r.ok) {
        setOpen(false);
        if (!dept) {
          setCode('');
          setName('');
        }
      } else setError(r.error);
    });

  if (!open)
    return dept ? (
      <button className="text-sm underline" onClick={() => setOpen(true)} data-testid="dept-edit">
        Edit
      </button>
    ) : (
      <Button size="sm" onClick={() => setOpen(true)} data-testid="dept-add">
        Add department
      </Button>
    );
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        className={`${field} w-24 font-mono`}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="CODE"
        aria-label="Department code"
        data-testid="dept-code"
      />
      <input
        className={`${field} w-56`}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name"
        aria-label="Department name"
        data-testid="dept-name"
      />
      {dept && (
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Active
        </label>
      )}
      <Button size="sm" onClick={save} disabled={pending} data-testid="dept-save">
        {pending ? 'Saving…' : 'Save'}
      </Button>
      <button className="text-sm underline" onClick={() => setOpen(false)}>
        Cancel
      </button>
      {error && (
        <span className="text-destructive w-full text-sm" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

/** Department picker for one HMP programme or one Dibba code; saves on change. */
export function DepartmentSelect({
  kind,
  target,
  value,
  departments,
  label,
}: {
  kind: 'programme' | 'dibba';
  target: string;
  value: string | null;
  departments: { id: string; name: string }[];
  label: string;
}) {
  const [current, setCurrent] = useState(value ?? '');
  // Follow changes made elsewhere on the page ("Use it", "Accept all") without losing the "Saved" note.
  useEffect(() => setCurrent(value ?? ''), [value]);
  const [state, setState] = useState<'idle' | 'saved' | string>('idle');
  const [pending, start] = useTransition();
  const change = (next: string) => {
    const before = current;
    setCurrent(next);
    start(async () => {
      const r =
        kind === 'programme'
          ? await setProgrammeDepartmentAction(target, next || null)
          : await setDibbaCodeDepartmentAction(target, next || null);
      if (r.ok) setState('saved');
      else {
        setCurrent(before);
        setState(r.error);
      }
    });
  };
  return (
    <span className="inline-flex items-center gap-2">
      <select
        className={field}
        value={current}
        onChange={(e) => change(e.target.value)}
        disabled={pending}
        aria-label={label}
        data-testid={`dept-select-${kind}`}
      >
        <option value="">— no department —</option>
        {departments.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
      {pending ? (
        <span className="text-muted-foreground text-xs">Saving…</span>
      ) : state === 'saved' ? (
        <span className="text-xs text-emerald-700">Saved</span>
      ) : state !== 'idle' ? (
        <span className="text-destructive text-xs" role="alert">
          {state}
        </span>
      ) : null}
    </span>
  );
}

/** "Use EEE" — accept the title's suggestion for one Dibba code. */
export function UseSuggestion({
  code,
  departmentId,
  name,
}: {
  code: string;
  departmentId: string;
  name: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2 text-xs">
      <button
        className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-amber-950 hover:bg-amber-100"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await setDibbaCodeDepartmentAction(code, departmentId);
            if (!r.ok) setError(r.error);
          })
        }
        data-testid="dept-use-suggestion"
      >
        {pending ? 'Saving…' : `Suggested: ${name} — use it`}
      </button>
      {error && <span className="text-destructive">{error}</span>}
    </span>
  );
}

export function AcceptAllTitleSuggestions({ count }: { count: number }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  if (count === 0 && !message) return null;
  return (
    <span className="inline-flex items-center gap-3">
      {count > 0 && (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await acceptDibbaTitleSuggestionsAction();
              setMessage(
                r.ok ? `Saved ${r.changed} department${r.changed === 1 ? '' : 's'}.` : r.error,
              );
            })
          }
          data-testid="dept-accept-all-titles"
        >
          {pending ? 'Saving…' : `Accept all ${count} suggestions`}
        </Button>
      )}
      {message && (
        <span className="text-sm" role="status">
          {message}
        </span>
      )}
    </span>
  );
}

/** v1.4.1 (H4): give existing requests their department's HOG — after the preview above it. */
export function ApplyHogBackfill({ count }: { count: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-3">
      {count > 0 && (
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await applyHogBackfillAction();
              setMessage(
                r.ok
                  ? `${r.changed} request${r.changed === 1 ? '' : 's'} now have their department's HOG.`
                  : r.error,
              );
              router.refresh();
            })
          }
          data-testid="hog-backfill-apply"
        >
          {pending ? 'Saving…' : `Give ${count} request${count === 1 ? '' : 's'} their HOG`}
        </Button>
      )}
      {message && (
        <span className="text-sm" role="status" data-testid="hog-backfill-message">
          {message}
        </span>
      )}
    </span>
  );
}

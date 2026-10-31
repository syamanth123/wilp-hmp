'use client';

import { useState, useTransition } from 'react';
import { Button, Label } from '@hmp/ui';
import type { RecommendationResult } from '@hmp/ai';
import { RecommendationList } from '@/components/recommendation-list';
import { allocateFacultyAction } from './actions';
import { facultyTypeLabel } from '@/lib/labels';

export interface FacultyChoice {
  id: string;
  name: string;
  email: string;
  facultyType: string | null;
  loadInSemester: number;
  capped: boolean;
}

export interface SmeChoice {
  id: string;
  name: string;
  email: string;
}

export function AllocationPanel({
  requestId,
  faculties,
  smes,
  cap,
  recommendation,
}: {
  requestId: string;
  faculties: FacultyChoice[];
  // Prompt 12-b: SME-role users for the (mandatory) SME picker.
  smes: SmeChoice[];
  cap: number;
  recommendation?: RecommendationResult | null;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [smeUserId, setSmeUserId] = useState('');
  // The roster can hold hundreds of faculty: search it, and keep ticked
  // faculty visible whatever the search says.
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = faculties.filter(
    (f) =>
      !q ||
      selected.has(f.id) ||
      f.name.toLowerCase().includes(q) ||
      f.email.toLowerCase().includes(q),
  );
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, startTransition] = useTransition();

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = () => {
    setError(null);
    if (selected.size === 0) {
      setError('Pick at least one faculty');
      return;
    }
    // Prompt 12-b: SME is mandatory at allocation (the approval gate needs a
    // designated SME). Client guard mirrors the action-layer requirement.
    if (!smeUserId) {
      setError('Select a Subject Matter Expert');
      return;
    }
    const fd = new FormData();
    fd.set('requestId', requestId);
    for (const id of selected) fd.append('facultyIds', id);
    fd.set('smeUserId', smeUserId);
    startTransition(async () => {
      const r = await allocateFacultyAction(fd);
      if (r?.error) setError(r.error);
      else setSuccess(true);
    });
  };

  if (success) {
    return (
      <p className="text-sm text-emerald-600">
        Faculty allocated and sent to the Programme Committee to confirm.
      </p>
    );
  }

  const addToSelection = (id: string) => {
    setSelected((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-3">
      {recommendation && (
        <RecommendationList requestId={requestId} result={recommendation} onPick={addToSelection} />
      )}
      <div>
        <Label>Faculty roster</Label>
        <p className="text-muted-foreground text-xs">
          Off-campus, adjunct and guest faculty can have at most {cap} courses per semester.
        </p>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${faculties.length} faculty by name or email`}
          aria-label="Search faculty"
          className="bg-background mt-2 h-9 w-full rounded-md border px-3 text-sm"
          data-testid="faculty-search"
        />
      </div>
      <ul className="max-h-96 divide-y overflow-y-auto rounded-md border">
        {faculties.length > 0 && shown.length === 0 && (
          <li className="text-muted-foreground p-3 text-sm">No faculty match that search.</li>
        )}
        {faculties.length === 0 && (
          <li className="text-muted-foreground p-3 text-sm">
            No active faculty accounts yet. Ask the administrator to add them.
          </li>
        )}
        {shown.map((f) => (
          <li key={f.id} className="flex items-center justify-between gap-3 p-3 text-sm">
            <label
              className={`flex flex-1 items-center gap-3 ${f.capped ? 'opacity-50' : 'cursor-pointer'}`}
            >
              <input
                type="checkbox"
                checked={selected.has(f.id)}
                disabled={f.capped}
                onChange={() => toggle(f.id)}
              />
              <span>
                <div className="font-medium">{f.name}</div>
                <div className="text-muted-foreground text-xs">{f.email}</div>
              </span>
            </label>
            <div className="text-muted-foreground text-right text-xs">
              <div>{facultyTypeLabel(f.facultyType)}</div>
              <div>
                {f.loadInSemester} {f.loadInSemester === 1 ? 'course' : 'courses'} this semester
                {f.capped ? ' (at the limit)' : ''}
              </div>
            </div>
          </li>
        ))}
      </ul>
      <div className="grid gap-1">
        <Label htmlFor="sme-picker">Subject Matter Expert (required)</Label>
        <p className="text-muted-foreground text-xs">
          The SME approves the faculty&apos;s submission before it reaches the Programme Committee.
        </p>
        <select
          id="sme-picker"
          value={smeUserId}
          onChange={(e) => setSmeUserId(e.target.value)}
          className="bg-background rounded-md border px-2 py-1.5 text-sm"
          data-testid="sme-picker"
        >
          <option value="">
            {smes.length === 0
              ? 'No subject experts yet — ask the administrator'
              : 'Choose a subject expert'}
          </option>
          {smes.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.email})
            </option>
          ))}
        </select>
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
      <Button onClick={submit} disabled={pending || selected.size === 0 || !smeUserId}>
        {pending ? 'Allocating…' : `Allocate ${selected.size || ''}`.trim()}
      </Button>
    </div>
  );
}

'use client';

import { useState, useTransition } from 'react';
import { Button, Label } from '@hmp/ui';
import type { RecommendationResult } from '@hmp/ai';
import { RecommendationList } from '@/components/recommendation-list';
import { allocateFacultyAction } from './actions';

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
      <p className="text-sm text-emerald-600">Faculty allocated. Status moved to ALLOCATED.</p>
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
          Off-campus / adjunct / guest faculty are capped at {cap} active courses per semester.
        </p>
      </div>
      <ul className="divide-y rounded-md border">
        {faculties.map((f) => (
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
              <div>{f.facultyType ?? 'unspecified'}</div>
              <div>
                load: {f.loadInSemester}
                {f.capped ? ' (capped)' : ''}
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
          <option value="">— Select an SME —</option>
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

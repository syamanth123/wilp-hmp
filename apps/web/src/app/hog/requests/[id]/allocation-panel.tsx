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

export function AllocationPanel({
  requestId,
  faculties,
  cap,
  recommendation,
}: {
  requestId: string;
  faculties: FacultyChoice[];
  cap: number;
  recommendation?: RecommendationResult | null;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
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
    const fd = new FormData();
    fd.set('requestId', requestId);
    for (const id of selected) fd.append('facultyIds', id);
    startTransition(async () => {
      const r = await allocateFacultyAction(fd);
      if (r?.error) setError(r.error);
      else setSuccess(true);
    });
  };

  if (success) {
    return <p className="text-sm text-emerald-600">Faculty allocated. Status moved to ALLOCATED.</p>;
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
        <p className="text-xs text-muted-foreground">
          Off-campus / adjunct / guest faculty are capped at {cap} active courses per semester.
        </p>
      </div>
      <ul className="divide-y rounded-md border">
        {faculties.map((f) => (
          <li key={f.id} className="flex items-center justify-between gap-3 p-3 text-sm">
            <label className={`flex flex-1 items-center gap-3 ${f.capped ? 'opacity-50' : 'cursor-pointer'}`}>
              <input
                type="checkbox"
                checked={selected.has(f.id)}
                disabled={f.capped}
                onChange={() => toggle(f.id)}
              />
              <span>
                <div className="font-medium">{f.name}</div>
                <div className="text-xs text-muted-foreground">{f.email}</div>
              </span>
            </label>
            <div className="text-right text-xs text-muted-foreground">
              <div>{f.facultyType ?? 'unspecified'}</div>
              <div>
                load: {f.loadInSemester}
                {f.capped ? ' (capped)' : ''}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button onClick={submit} disabled={pending || selected.size === 0}>
        {pending ? 'Allocating…' : `Allocate ${selected.size || ''}`.trim()}
      </Button>
    </div>
  );
}

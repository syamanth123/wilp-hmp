'use client';

import { useState, useTransition } from 'react';
import { Button, Label } from '@hmp/ui';
import type { RecommendationResult } from '@hmp/ai';
import { RecommendationList } from '@/components/recommendation-list';
import { allocateFacultyAction } from './actions';
import { facultyTypeLabel } from '@/lib/labels';

/** v1.4 §C: a person the HOG can pick, with their department and open-work load. */
export interface PersonChoice {
  id: string;
  name: string;
  email: string;
  departmentName: string | null;
  /** In the course's department (or the course has no department). */
  sameDepartment: boolean;
  /** "3 open handouts · 1 overdue" */
  load: string;
}

export interface FacultyChoice extends PersonChoice {
  facultyType: string | null;
  loadInSemester: number;
  capped: boolean;
}

/** Course's department first, then by name. */
const deptFirst = <T extends PersonChoice>(xs: T[]) =>
  [...xs].sort(
    (a, b) => Number(b.sameDepartment) - Number(a.sameDepartment) || a.name.localeCompare(b.name),
  );

const otherDeptText = (p: PersonChoice) =>
  p.sameDepartment
    ? ''
    : p.departmentName
      ? ` (other dept · ${p.departmentName})`
      : ' (no department)';

function OtherDept({ p }: { p: PersonChoice }) {
  if (p.sameDepartment) return null;
  return (
    <span
      className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-900"
      data-testid="other-dept"
    >
      {p.departmentName ? `other dept · ${p.departmentName}` : 'no department'}
    </span>
  );
}

export function AllocationPanel({
  requestId,
  faculties,
  smes,
  pcs,
  departmentName,
  cap,
  recommendation,
}: {
  requestId: string;
  faculties: FacultyChoice[];
  // Prompt 12-b: SME-role users for the (mandatory) SME picker.
  smes: PersonChoice[];
  // v1.4 §C: the Programme Committee member who confirms this allocation.
  pcs: PersonChoice[];
  departmentName: string | null;
  cap: number;
  recommendation?: RecommendationResult | null;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [smeUserId, setSmeUserId] = useState('');
  // v1.4: the department's people first; "Show all departments" adds the rest (marked "other dept").
  const [showAll, setShowAll] = useState(false);
  const visible = (p: PersonChoice) => showAll || p.sameDepartment;
  const pcList = deptFirst(pcs);
  const [pcUserId, setPcUserId] = useState(pcList.find((p) => p.sameDepartment)?.id ?? '');
  const otherCount = [...faculties, ...smes, ...pcs].filter((p) => !p.sameDepartment).length;
  // The roster can hold hundreds of faculty: search it, and keep ticked
  // faculty visible whatever the search says. A search looks in every department.
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = deptFirst(faculties).filter((f) =>
    selected.has(f.id)
      ? true
      : q
        ? f.name.toLowerCase().includes(q) || f.email.toLowerCase().includes(q)
        : visible(f),
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
    if (pcs.length > 0 && !pcUserId) {
      setError('Choose the Programme Committee member who confirms it.');
      return;
    }
    const fd = new FormData();
    fd.set('requestId', requestId);
    for (const id of selected) fd.append('facultyIds', id);
    fd.set('smeUserId', smeUserId);
    if (pcUserId) fd.set('pcUserId', pcUserId);
    startTransition(async () => {
      const r = await allocateFacultyAction(fd);
      if (r?.error) setError(r.error);
      else setSuccess(true);
    });
  };

  if (success) {
    return (
      <p className="text-sm text-emerald-600">
        Faculty allocated and sent to{' '}
        {pcs.find((p) => p.id === pcUserId)?.name ?? 'the Programme Committee'} to confirm.
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
      {departmentName && (
        <div className="bg-accent flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
          <span data-testid="alloc-department">
            Showing <strong>{departmentName}</strong> people
            {showAll ? ' first, then everyone else' : ''}.
          </span>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
              data-testid="alloc-show-all"
            />
            Show all departments{otherCount ? ` (${otherCount} more)` : ''}
          </label>
        </div>
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
          placeholder={`Search all ${faculties.length} faculty by name or email`}
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
                <div className="font-medium">
                  {f.name}
                  <OtherDept p={f} />
                </div>
                <div className="text-muted-foreground text-xs">{f.email}</div>
              </span>
            </label>
            <div className="text-muted-foreground text-right text-xs">
              <div>{facultyTypeLabel(f.facultyType)}</div>
              <div className={f.load.includes('overdue') ? 'font-medium text-red-700' : ''}>
                {f.load}
              </div>
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
          {deptFirst(smes)
            .filter((s) => visible(s) || s.id === smeUserId)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.load}
                {otherDeptText(s)}
              </option>
            ))}
        </select>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="pc-picker">Programme Committee member who confirms</Label>
        <p className="text-muted-foreground text-xs">
          Only this person is asked to confirm the allocation.
        </p>
        <select
          id="pc-picker"
          value={pcUserId}
          onChange={(e) => setPcUserId(e.target.value)}
          className="bg-background rounded-md border px-2 py-1.5 text-sm"
          data-testid="pc-picker"
        >
          <option value="">
            {pcs.length === 0
              ? 'No Programme Committee members yet — any PC can confirm'
              : 'Choose a PC member'}
          </option>
          {pcList
            .filter((p) => visible(p) || p.id === pcUserId)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.load}
                {otherDeptText(p)}
              </option>
            ))}
        </select>
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
      <Button
        onClick={submit}
        disabled={pending || selected.size === 0 || !smeUserId || (pcs.length > 0 && !pcUserId)}
      >
        {pending ? 'Allocating…' : `Allocate ${selected.size || ''}`.trim()}
      </Button>
    </div>
  );
}

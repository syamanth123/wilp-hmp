'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Label } from '@hmp/ui';
import { createRequestAction } from './actions';

export interface OfferingOption {
  id: string;
  courseCode: string;
  courseTitle: string;
  programmeCode: string;
  programmeName: string;
  semesterName: string;
  slotInfo: string | null;
  /** v1.4: the programme's department (decides the pre-selected HOG). */
  departmentId: string | null;
  departmentName: string | null;
}

/** v1.4: a Head of Group the request can go to. */
export interface HogOption {
  id: string;
  name: string;
  departmentId: string | null;
  departmentName: string | null;
  load: string;
}

export function RequestForm({
  offerings,
  hogs,
  initial,
}: {
  offerings: OfferingOption[];
  hogs: HogOption[];
  /** Filled in from the Handout Library (a not-started course). */
  initial?: { programmeCode: string; semesterName: string; offeringId: string };
}) {
  const router = useRouter();
  const [programmeCode, setProgrammeCode] = useState(initial?.programmeCode ?? '');
  const [semesterName, setSemesterName] = useState(initial?.semesterName ?? '');
  const [offeringId, setOfferingIdRaw] = useState(initial?.offeringId ?? '');
  const deptOf = (id: string) => offerings.find((o) => o.id === id) ?? null;
  const deptHogOf = (id: string) => {
    const d = deptOf(id)?.departmentId;
    return d ? (hogs.find((h) => h.departmentId === d) ?? null) : null;
  };
  // v1.4: the course's department HOG is pre-selected; another HOG needs a reason.
  const [hogId, setHogId] = useState(deptHogOf(initial?.offeringId ?? '')?.id ?? '');
  const [hogReason, setHogReason] = useState('');
  const setOfferingId = (id: string) => {
    setOfferingIdRaw(id);
    setHogId(deptHogOf(id)?.id ?? '');
    setHogReason('');
  };
  const chosen = deptOf(offeringId);
  const deptHog = deptHogOf(offeringId);
  const otherHog = !!hogId && hogId !== deptHog?.id;
  const orderedHogs = [...hogs].sort(
    (a, b) =>
      Number(b.departmentId === chosen?.departmentId) -
        Number(a.departmentId === chosen?.departmentId) || a.name.localeCompare(b.name),
  );
  const [notes, setNotes] = useState('');
  const [prevUrl, setPrevUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const programmes = useMemo(
    () =>
      Array.from(new Map(offerings.map((o) => [o.programmeCode, o.programmeName])).entries()).map(
        ([code, name]) => ({ code, name }),
      ),
    [offerings],
  );
  const semesters = useMemo(
    () =>
      programmeCode
        ? Array.from(
            new Set(
              offerings.filter((o) => o.programmeCode === programmeCode).map((o) => o.semesterName),
            ),
          )
        : [],
    [offerings, programmeCode],
  );
  const courses = useMemo(
    () =>
      programmeCode && semesterName
        ? offerings.filter(
            (o) => o.programmeCode === programmeCode && o.semesterName === semesterName,
          )
        : [],
    [offerings, programmeCode, semesterName],
  );

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    if (!offeringId) {
      setError('Pick a course');
      return;
    }
    if (!hogId) {
      setError('Pick the Head of Group who will allocate it.');
      return;
    }
    if (otherHog && hogReason.trim().length < 5) {
      setError('Say why it goes to a HOG outside the course’s department.');
      return;
    }
    const fd = new FormData();
    fd.set('courseOfferingId', offeringId);
    fd.set('notes', notes);
    fd.set('previousHandoutUrl', prevUrl);
    fd.set('hogId', hogId);
    fd.set('hogReason', otherHog ? hogReason.trim() : '');
    startTransition(async () => {
      const r = await createRequestAction(fd);
      if (r && 'error' in r) {
        setError(r.error ?? 'Failed');
      } else {
        router.refresh();
      }
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-2">
        <Label htmlFor="rf-programme">Programme</Label>
        <select
          id="rf-programme"
          className="bg-background h-9 rounded-md border px-2 text-sm"
          value={programmeCode}
          onChange={(e) => {
            setProgrammeCode(e.target.value);
            setSemesterName('');
            setOfferingId('');
          }}
        >
          <option value="">Select programme…</option>
          {programmes.map((p) => (
            <option key={p.code} value={p.code}>
              {p.code} — {p.name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="rf-semester">Semester</Label>
        <select
          id="rf-semester"
          className="bg-background h-9 rounded-md border px-2 text-sm"
          value={semesterName}
          onChange={(e) => {
            setSemesterName(e.target.value);
            setOfferingId('');
          }}
          disabled={!programmeCode}
        >
          <option value="">Select semester…</option>
          {semesters.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="rf-course">Course</Label>
        <select
          id="rf-course"
          className="bg-background h-9 rounded-md border px-2 text-sm"
          value={offeringId}
          onChange={(e) => setOfferingId(e.target.value)}
          disabled={!semesterName}
        >
          <option value="">Select course…</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.courseCode} — {c.courseTitle} {c.slotInfo ? `(${c.slotInfo})` : ''}
            </option>
          ))}
        </select>
      </div>

      {offeringId && (
        <div className="grid gap-2 rounded-md border p-3" data-testid="rf-hog-section">
          <Label htmlFor="rf-hog">Head of Group</Label>
          <select
            id="rf-hog"
            className="bg-background h-9 rounded-md border px-2 text-sm"
            value={hogId}
            onChange={(e) => setHogId(e.target.value)}
            data-testid="rf-hog"
          >
            <option value="">Select the HOG…</option>
            {orderedHogs.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name} — {h.departmentName ?? 'no department'} · {h.load}
                {h.id === deptHog?.id ? ' (this course’s department)' : ''}
              </option>
            ))}
          </select>
          <p className="text-muted-foreground text-xs" data-testid="rf-hog-hint">
            {deptHog && otherHog
              ? `${chosen?.departmentName}’s HOG is ${deptHog.name}. You chose a HOG from another department — say why below. Only the HOG you choose is told about the request.`
              : deptHog
                ? `${chosen?.departmentName} → ${deptHog.name} is pre-selected. Only this HOG is told about the request.`
                : chosen?.departmentName
                  ? `${chosen.departmentName} has no HOG yet — pick one (Admin → People sets the department HOG).`
                  : 'This course’s programme has no department yet (Admin → Departments) — pick a HOG.'}
          </p>
          {otherHog && deptHog && (
            <div className="grid gap-1">
              <Label htmlFor="rf-hog-reason">Why a HOG outside {chosen?.departmentName}?</Label>
              <textarea
                id="rf-hog-reason"
                value={hogReason}
                onChange={(e) => setHogReason(e.target.value)}
                className="bg-background min-h-[60px] rounded-md border p-2 text-sm"
                placeholder="e.g. Dr X is on leave until 20 Nov"
                data-testid="rf-hog-reason"
              />
            </div>
          )}
        </div>
      )}

      <div className="grid gap-2">
        <Label htmlFor="prevUrl">Previous handout URL (optional)</Label>
        <Input
          id="prevUrl"
          type="url"
          value={prevUrl}
          onChange={(e) => setPrevUrl(e.target.value)}
          placeholder="https://…"
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="notes">Notes (optional)</Label>
        <textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="bg-background min-h-[80px] rounded-md border p-2 text-sm"
        />
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Creating…' : 'Create request'}
        </Button>
      </div>
    </form>
  );
}

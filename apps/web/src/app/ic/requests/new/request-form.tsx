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
}

export function RequestForm({
  offerings,
  initial,
}: {
  offerings: OfferingOption[];
  /** Filled in from the Handout Library (a not-started course). */
  initial?: { programmeCode: string; semesterName: string; offeringId: string };
}) {
  const router = useRouter();
  const [programmeCode, setProgrammeCode] = useState(initial?.programmeCode ?? '');
  const [semesterName, setSemesterName] = useState(initial?.semesterName ?? '');
  const [offeringId, setOfferingId] = useState(initial?.offeringId ?? '');
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
    const fd = new FormData();
    fd.set('courseOfferingId', offeringId);
    fd.set('notes', notes);
    fd.set('previousHandoutUrl', prevUrl);
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

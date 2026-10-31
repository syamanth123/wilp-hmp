'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Label } from '@hmp/ui';
import { updateTermAction } from './actions';

interface Props {
  term: {
    id: string;
    name: string;
    year: number;
    term: string;
    startDate: string; // YYYY-MM-DD
    endDate: string;
    hasPublishedImport: boolean;
  };
}

/** Edit an AcademicTerm (Phase 4, plan D3). Same fields and rules as creating one. */
export function EditTermForm({ term }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(fd) => {
        setError(null);
        setSaved(false);
        startTransition(async () => {
          const res = await updateTermAction(fd);
          if ('error' in res) {
            setError(res.error);
            return;
          }
          setSaved(true);
          router.refresh();
        });
      }}
      className="grid grid-cols-1 gap-3 md:grid-cols-6"
      data-testid="dibba-term-edit-form"
    >
      <input type="hidden" name="termId" value={term.id} />
      <div className="md:col-span-2">
        <Label htmlFor="edit-term-name">Term name</Label>
        <Input id="edit-term-name" name="name" defaultValue={term.name} required maxLength={120} />
      </div>
      <div>
        <Label htmlFor="edit-term-year">Year</Label>
        <Input
          id="edit-term-year"
          name="year"
          type="number"
          min={2000}
          max={2100}
          defaultValue={term.year}
          required
        />
      </div>
      <div>
        <Label htmlFor="edit-term-term">Term</Label>
        <select
          id="edit-term-term"
          name="term"
          defaultValue={term.term}
          className="bg-background h-9 w-full rounded-md border px-2 text-sm"
        >
          <option value="FIRST">Semester 1</option>
          <option value="SECOND">Semester 2</option>
          <option value="SUMMER">Summer term</option>
        </select>
      </div>
      <div>
        <Label htmlFor="edit-term-start">Start date</Label>
        <Input
          id="edit-term-start"
          name="startDate"
          type="date"
          defaultValue={term.startDate}
          required
        />
      </div>
      <div>
        <Label htmlFor="edit-term-end">End date</Label>
        <Input id="edit-term-end" name="endDate" type="date" defaultValue={term.endDate} required />
      </div>
      <div className="flex flex-wrap items-center gap-3 md:col-span-6">
        <Button type="submit" disabled={pending} data-testid="dibba-term-edit-submit">
          {pending ? 'Saving…' : 'Save term'}
        </Button>
        {term.hasPublishedImport && (
          <span className="text-muted-foreground text-xs">
            This term has a published schedule; renaming it or changing its year/term relabels that
            schedule, it does not move it.
          </span>
        )}
        {error && (
          <span
            className="text-destructive text-sm"
            role="alert"
            data-testid="dibba-term-edit-error"
          >
            {error}
          </span>
        )}
        {saved && (
          <span className="text-sm text-emerald-700" data-testid="dibba-term-edit-done">
            Saved.
          </span>
        )}
      </div>
    </form>
  );
}

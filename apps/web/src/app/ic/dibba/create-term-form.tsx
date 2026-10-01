'use client';

import { useRef, useState, useTransition } from 'react';
import { Button, Input, Label } from '@hmp/ui';
import { createTermAction } from './actions';

/**
 * Create an AcademicTerm (plan D5). Production has no other way to get a term;
 * the dev seed's '2025-26 Sem 1' never runs there. Creating a term also seeds
 * its 8 standard slots (times blank — Phase 4 edits them). Editing is Phase 4.
 */
export function CreateTermForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const thisYear = new Date().getFullYear();

  return (
    <form
      ref={formRef}
      action={(fd) => {
        setError(null);
        setCreated(null);
        const name = String(fd.get('name') ?? '').trim();
        startTransition(async () => {
          const res = await createTermAction(fd);
          if ('error' in res) {
            setError(res.error);
            return;
          }
          setCreated(name);
          formRef.current?.reset();
        });
      }}
      className="grid grid-cols-1 gap-3 md:grid-cols-6"
      data-testid="dibba-create-term-form"
    >
      <div className="md:col-span-2">
        <Label htmlFor="term-name">Term name</Label>
        <Input id="term-name" name="name" placeholder="2025-26 Sem 1" required maxLength={120} />
      </div>
      <div>
        <Label htmlFor="term-year">Year</Label>
        <Input
          id="term-year"
          name="year"
          type="number"
          min={2000}
          max={2100}
          defaultValue={thisYear}
          required
        />
      </div>
      <div>
        <Label htmlFor="term-term">Term</Label>
        <select
          id="term-term"
          name="term"
          defaultValue="FIRST"
          className="bg-background h-9 w-full rounded-md border px-2 text-sm"
        >
          <option value="FIRST">FIRST</option>
          <option value="SECOND">SECOND</option>
          <option value="SUMMER">SUMMER</option>
        </select>
      </div>
      <div>
        <Label htmlFor="term-start">Start date</Label>
        <Input id="term-start" name="startDate" type="date" required />
      </div>
      <div>
        <Label htmlFor="term-end">End date</Label>
        <Input id="term-end" name="endDate" type="date" required />
      </div>
      <div className="flex flex-wrap items-center gap-3 md:col-span-6">
        <Button type="submit" disabled={pending} data-testid="dibba-create-term-submit">
          {pending ? 'Creating…' : 'Create term'}
        </Button>
        {error && (
          <span
            className="text-destructive text-sm"
            role="alert"
            data-testid="dibba-create-term-error"
          >
            {error}
          </span>
        )}
        {created && (
          <span className="text-sm text-emerald-700" data-testid="dibba-create-term-done">
            Created &lsquo;{created}&rsquo; with the 8 standard slots.
          </span>
        )}
      </div>
    </form>
  );
}

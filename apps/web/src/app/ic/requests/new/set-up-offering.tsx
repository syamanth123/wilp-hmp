'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { Button } from '@hmp/ui';
import { setUpOfferingAction } from './actions';

export interface SetUpChoice {
  semesterId: string;
  programmeCode: string;
  dibbaProgramme: string;
  semesterName: string;
}

/**
 * The confirmation before HMP adds a course offering from the Course Dibba (and the course, when
 * no code of the class is in the catalogue). Nothing is written until "Add and continue".
 */
export function SetUpOffering({
  codes,
  term,
  title,
  newCourse,
  skippedCodes,
  choices,
  notSetUp,
  mixedNumbers,
}: {
  codes: string[];
  term: string;
  title: string;
  /** The course isn't in the catalogue yet and will be added. */
  newCourse: boolean;
  skippedCodes: string[];
  choices: SetUpChoice[];
  notSetUp: string[];
  mixedNumbers: boolean;
}) {
  const [semesterId, setSemesterId] = useState(choices[0]!.semesterId);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const chosen = choices.find((c) => c.semesterId === semesterId) ?? choices[0]!;
  const codeList = codes.join(' / ');

  const confirm = () => {
    setError(null);
    const fd = new FormData();
    fd.set('courses', codes.join(','));
    fd.set('term', term);
    fd.set('semesterId', semesterId);
    startTransition(async () => {
      const r = await setUpOfferingAction(fd);
      if (r && 'error' in r)
        setError(r.error ?? 'That didn’t work. Reload the page and try again.');
    });
  };

  return (
    <section
      role="alertdialog"
      aria-labelledby="setup-title"
      aria-describedby="setup-summary"
      className="border-[var(--bits-navy)]/30 bg-[var(--bits-navy)]/5 space-y-3 rounded-md border p-4 text-sm"
      data-testid="setup-confirm"
    >
      <h2 id="setup-title" className="text-base font-semibold">
        Add this course to HMP and create a request?
      </h2>
      <p id="setup-summary" data-testid="setup-summary">
        This will add <strong>{codeList}</strong> to <strong>{chosen.semesterName}</strong> (
        {chosen.programmeCode}) and open a new request.
      </p>
      {codes.length > 1 && (
        <p data-testid="setup-codes">
          The request covers all {codes.length} codes: {codes.join(', ')}.
        </p>
      )}
      {mixedNumbers && (
        <p className="font-medium text-amber-800" data-testid="setup-mixed-numbers">
          These codes have different course numbers. Check they are one class before you continue.
        </p>
      )}
      <p className="text-muted-foreground">
        {newCourse
          ? `${codes[0]} isn’t in the course catalogue yet; it will be added as “${title}”.`
          : `Uses the catalogue course “${title}”, unchanged.`}
        {skippedCodes.length > 0 &&
          ` ${skippedCodes.join(', ')} ${skippedCodes.length === 1 ? 'isn’t a standard course number, so it isn’t' : 'aren’t standard course numbers, so they aren’t'} stored with the course.`}
      </p>

      {choices.length > 1 && (
        <fieldset className="space-y-1">
          <legend className="mb-1 font-medium">Programme</legend>
          {choices.map((c) => (
            <label key={c.semesterId} className="flex items-center gap-2">
              <input
                type="radio"
                name="setup-programme"
                value={c.semesterId}
                checked={c.semesterId === semesterId}
                onChange={() => setSemesterId(c.semesterId)}
              />
              {c.programmeCode} — {c.semesterName}
              {c.dibbaProgramme !== c.programmeCode && (
                <span className="text-muted-foreground">(Dibba: {c.dibbaProgramme})</span>
              )}
            </label>
          ))}
        </fieldset>
      )}
      {notSetUp.length > 0 && (
        <p className="text-muted-foreground" data-testid="setup-not-set-up">
          Not set up in HMP for this semester, so not offered here: {notSetUp.join(', ')}.
        </p>
      )}

      {error && (
        <p className="text-destructive" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={confirm}
          disabled={pending}
          data-testid="setup-confirm-button"
        >
          {pending ? 'Adding…' : 'Add and continue'}
        </Button>
        <Link href="/handouts?tab=in-progress&view=not-started" className="underline">
          Cancel
        </Link>
      </div>
    </section>
  );
}

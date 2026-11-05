'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { Button } from '@hmp/ui';
import { createTaxilaRunAction } from '@/app/ic/taxila-runs/actions';
import { BULK_FORM_ID } from './bulk-form-id';

const boxes = () =>
  Array.from(
    document.querySelectorAll<HTMLInputElement>(`input[form="${BULK_FORM_ID}"][type="checkbox"]`),
  );

/**
 * IC / Admin (v1.3.0): tick approved handouts in the list, then start a bulk run. The row
 * checkboxes belong to this form through their `form` attribute.
 */
export function BulkPublishBar({ defaultSemesterCode }: { defaultSemesterCode: string }) {
  const [code, setCode] = useState(defaultSemesterCode);
  const [ticked, setTicked] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const recount = () => {
      setTicked(boxes().filter((b) => b.checked).length);
      setTotal(boxes().length);
    };
    recount();
    document.addEventListener('change', recount);
    return () => document.removeEventListener('change', recount);
  }, []);

  const tickAll = (on: boolean) => {
    boxes().forEach((b) => (b.checked = on));
    setTicked(on ? boxes().length : 0);
  };

  return (
    <form
      id={BULK_FORM_ID}
      className="border-[var(--bits-navy)]/20 bg-[var(--bits-navy)]/5 flex w-full flex-wrap items-end gap-2 rounded-md border p-2"
      data-testid="bulk-publish-bar"
      action={(fd) => {
        setError(null);
        startTransition(async () => {
          const r = await createTaxilaRunAction(fd);
          if (r?.error) setError(r.error);
        });
      }}
    >
      <div>
        <label htmlFor="bulk-semester" className="text-muted-foreground mb-1 block text-xs">
          Taxila semester code
        </label>
        <input
          id="bulk-semester"
          name="semesterCode"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="e.g. S1-26"
          className="bg-background h-9 w-28 rounded-md border px-2 font-mono text-sm"
          data-testid="bulk-semester-code"
        />
      </div>
      <Button
        type="button"
        variant="outline"
        onClick={() => tickAll(ticked < total)}
        disabled={total === 0}
      >
        {ticked < total || total === 0 ? 'Tick all approved on this page' : 'Untick all'}
      </Button>
      <Button
        type="submit"
        disabled={pending || ticked === 0 || !code.trim()}
        data-testid="bulk-publish-start"
      >
        {pending ? 'Starting…' : `Bulk publish to Taxila (${ticked})`}
      </Button>
      <Link href="/ic/taxila-runs" className="text-muted-foreground self-center text-xs underline">
        Earlier runs
      </Link>
      {error && (
        <p className="text-destructive w-full text-sm" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

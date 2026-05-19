'use client';

import { useState, useTransition } from 'react';
import { Button } from '@hmp/ui';
import { runSweepAction } from './actions';

interface Summary {
  scanned: number;
  dueSoon: number;
  overdue: number;
  notified: number;
}

export function RunSweepPanel() {
  const [pending, startTransition] = useTransition();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <Button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await runSweepAction();
            if ('error' in result) setError(result.error);
            else setSummary(result);
          })
        }
      >
        {pending ? 'Sweeping…' : 'Run reminder sweep now'}
      </Button>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {summary && (
        <p className="text-sm text-muted-foreground">
          Scanned {summary.scanned} active requests · {summary.dueSoon} due soon ·{' '}
          {summary.overdue} overdue · {summary.notified} reminder(s) sent.
        </p>
      )}
    </div>
  );
}

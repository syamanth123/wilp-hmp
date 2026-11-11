'use client';

import { useState, useTransition } from 'react';
import { Button } from '@hmp/ui';
import { runSweepAction } from './actions';

interface Summary {
  reminders?: number;
  notified?: number;
  digests?: number;
  failed?: number;
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
        {pending ? 'Running…' : 'Run the daily run now'}
      </Button>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {summary && (
        <p className="text-muted-foreground text-sm">
          {summary.reminders ?? 0} reminder(s) or escalation step(s) · {summary.notified ?? 0}{' '}
          people told · {summary.digests ?? 0} daily digest(s) sent
          {summary.failed ? ` · ${summary.failed} digest(s) failed` : ''}. Each step is sent once,
          so running it again only sends what is new.
        </p>
      )}
    </div>
  );
}

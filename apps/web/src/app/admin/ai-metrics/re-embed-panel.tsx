'use client';

import { useState, useTransition } from 'react';
import { Button } from '@hmp/ui';
import { runReEmbedAction } from './actions';

interface Summary {
  courses: number;
  faculty: number;
  skipped: number;
}

export function ReEmbedPanel() {
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
            const result = await runReEmbedAction();
            if ('error' in result) setError(result.error);
            else setSummary(result);
          })
        }
      >
        {pending ? 'Re-embedding…' : 'Re-embed all (courses + faculty)'}
      </Button>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {summary && (
        <p className="text-sm text-muted-foreground">
          Embedded {summary.courses} course(s) · {summary.faculty} faculty · skipped{' '}
          {summary.skipped}.
        </p>
      )}
    </div>
  );
}

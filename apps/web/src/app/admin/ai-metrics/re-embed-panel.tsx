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
        {pending ? 'Refreshing…' : 'Refresh AI matching data'}
      </Button>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {summary && (
        <p className="text-muted-foreground text-sm">
          Updated {summary.courses} courses and {summary.faculty} faculty; skipped {summary.skipped}
          .
        </p>
      )}
    </div>
  );
}

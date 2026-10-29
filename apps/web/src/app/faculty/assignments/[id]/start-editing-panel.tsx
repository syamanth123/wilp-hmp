'use client';

import { useState, useTransition } from 'react';
import { Button } from '@hmp/ui';
import { startEditingAction } from './actions';

export function StartEditingPanel({ requestId }: { requestId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const start = () => {
    setError(null);
    const fd = new FormData();
    fd.set('requestId', requestId);
    startTransition(async () => {
      const r = await startEditingAction(fd);
      if (r?.error) setError(r.error);
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">Start from last year&apos;s handout</p>
      <p className="text-muted-foreground text-sm">
        The editor opens with the most recent approved handout for this course, or a blank one if
        there is none. A note at the top says which.
      </p>
      {error && <p className="text-destructive text-sm">{error}</p>}
      <Button onClick={start} disabled={pending}>
        {pending ? 'Starting…' : 'Start editing'}
      </Button>
    </div>
  );
}

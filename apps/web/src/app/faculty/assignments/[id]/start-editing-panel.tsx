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
      <p className="text-sm text-muted-foreground">
        Starting will seed a v1 from the Standard Handout template and move the status to IN_PROGRESS.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button onClick={start} disabled={pending}>
        {pending ? 'Starting…' : 'Start editing'}
      </Button>
    </div>
  );
}

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
      <p className="text-muted-foreground text-sm">
        Starting will pre-populate the structured editor from the most relevant available source
        (prior published handout for this course → empty template), move the status to IN_PROGRESS,
        and open the editor with a banner showing which source was used.
      </p>
      {error && <p className="text-destructive text-sm">{error}</p>}
      <Button onClick={start} disabled={pending}>
        {pending ? 'Starting…' : 'Start editing'}
      </Button>
    </div>
  );
}

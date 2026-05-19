'use client';

import { useState, useTransition } from 'react';
import { Button } from '@hmp/ui';
import { acceptAssignmentAction } from './actions';

export function AcceptPanel({ requestId }: { requestId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const accept = () => {
    setError(null);
    const fd = new FormData();
    fd.set('requestId', requestId);
    startTransition(async () => {
      const r = await acceptAssignmentAction(fd);
      if (r?.error) setError(r.error);
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Accept this assignment to begin editing the handout. The PC will be notified once you submit.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button onClick={accept} disabled={pending}>
        {pending ? 'Accepting…' : 'Accept assignment'}
      </Button>
    </div>
  );
}

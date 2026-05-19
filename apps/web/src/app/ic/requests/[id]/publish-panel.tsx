'use client';

import { useState, useTransition } from 'react';
import { Button } from '@hmp/ui';
import { publishAction } from './actions';

export function PublishPanel({ requestId }: { requestId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = () => {
    setError(null);
    setSuccess(null);
    const fd = new FormData();
    fd.set('requestId', requestId);
    startTransition(async () => {
      const r = await publishAction(fd);
      if (r?.error) setError(r.error);
      else setSuccess('Published to LMS. See publish log below.');
    });
  };

  if (success) return <p className="text-sm text-emerald-600">{success}</p>;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Pushes the approved handout to Taxila (stubbed) and moves the request to PUBLISHED.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button onClick={run} disabled={pending}>
        {pending ? 'Publishing…' : 'Publish to LMS'}
      </Button>
    </div>
  );
}

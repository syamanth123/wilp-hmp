'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@hmp/ui';
import { retryFailedJobAction, deleteFailedJobAction, clearCompletedAction } from './actions';

type QueueName = 'notifications' | 'ai';

function useRun() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const run = (fn: (fd: FormData) => Promise<{ ok?: boolean; error?: string }>, fd: FormData) => {
    setError(null);
    start(async () => {
      const r = await fn(fd);
      if (r?.error) setError(r.error);
      else router.refresh();
    });
  };
  return { pending, error, run };
}

export function FailedJobActions({ queue, jobId }: { queue: QueueName; jobId: string }) {
  const { pending, error, run } = useRun();
  const fd = () => {
    const f = new FormData();
    f.set('queue', queue);
    f.set('jobId', jobId);
    return f;
  };
  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => run(retryFailedJobAction, fd())}
      >
        Retry
      </Button>
      <Button
        size="sm"
        variant="destructive"
        disabled={pending}
        onClick={() => {
          if (confirm(`Delete failed job ${jobId}? This cannot be undone.`))
            run(deleteFailedJobAction, fd());
        }}
      >
        Delete
      </Button>
      {error && <span className="text-destructive text-xs">{error}</span>}
    </div>
  );
}

export function ClearCompletedButton({ queue }: { queue: QueueName }) {
  const { pending, error, run } = useRun();
  const fd = () => {
    const f = new FormData();
    f.set('queue', queue);
    return f;
  };
  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => run(clearCompletedAction, fd())}
      >
        {pending ? 'Clearing…' : 'Clear completed'}
      </Button>
      {error && <span className="text-destructive text-xs">{error}</span>}
    </div>
  );
}

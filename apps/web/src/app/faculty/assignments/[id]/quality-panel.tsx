'use client';

import { useState, useTransition } from 'react';
import { Button } from '@hmp/ui';
import { runQualityCheckAction } from './actions';

export function QualityPanel({ requestId }: { requestId: string }) {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ message: string; tone: 'ok' | 'error' } | null>(null);

  const run = () => {
    setStatus(null);
    const fd = new FormData();
    fd.set('requestId', requestId);
    startTransition(async () => {
      const r = await runQualityCheckAction(fd);
      if ('error' in r && r.error) {
        setStatus({ message: r.error, tone: 'error' });
      } else if ('ok' in r && r.ok) {
        setStatus({
          message: r.cached
            ? `Cached report shown (score ${((r.score ?? 0) * 100).toFixed(0)}).`
            : `Fresh report ready (score ${((r.score ?? 0) * 100).toFixed(0)}).`,
          tone: 'ok',
        });
      }
    });
  };

  return (
    <div className="flex items-start gap-3">
      <Button type="button" onClick={run} disabled={pending} variant="secondary">
        {pending ? 'Running…' : 'Run quality check'}
      </Button>
      {status && (
        <p className={`text-sm ${status.tone === 'error' ? 'text-destructive' : 'text-emerald-700'}`}>
          {status.message}
        </p>
      )}
    </div>
  );
}

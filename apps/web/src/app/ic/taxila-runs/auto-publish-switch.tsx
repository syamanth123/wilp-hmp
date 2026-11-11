'use client';

import { useState, useTransition } from 'react';
import { Button } from '@hmp/ui';
import { setAutoPublishAction } from './actions';

/** v1.4.2 (F11, H23): IC → Earlier runs → "Publish automatically after final approval". */
export function AutoPublishSwitch({ on }: { on: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm" data-testid="auto-publish-switch">
      <span>
        Publish to Taxila automatically after the HOG&apos;s final approval:{' '}
        <strong data-testid="auto-publish-state">{on ? 'On' : 'Off'}</strong>
      </span>
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await setAutoPublishAction(!on);
            if ('error' in r) setError(r.error);
          })
        }
      >
        {on ? 'Switch off' : 'Switch on'}
      </Button>
      {error ? <span className="text-destructive">{error}</span> : null}
    </div>
  );
}

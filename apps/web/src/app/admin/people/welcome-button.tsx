'use client';

import { useState, useTransition } from 'react';
import { Button } from '@hmp/ui';
import { sendWelcomeAction } from './actions';

/** v1.4.3 (H33): send the welcome email (again) — e.g. on the day the portal is announced. */
export function WelcomeButton({ userId, lastSent }: { userId: string; lastSent: string | null }) {
  const [r, setR] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const x = await sendWelcomeAction(userId);
            setR(x.ok ? { ok: true, text: x.message } : { ok: false, text: x.error });
          })
        }
        data-testid="person-send-welcome"
      >
        {lastSent ? 'Send the welcome email again' : 'Send welcome email'}
      </Button>
      <span className="text-muted-foreground">
        {lastSent ? `Last sent ${lastSent}.` : 'Not sent yet.'} No password is ever in it.
      </span>
      {r ? (
        <span className={r.ok ? 'text-emerald-800' : 'text-red-700'} role="status">
          {r.text}
        </span>
      ) : null}
    </div>
  );
}

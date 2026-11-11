'use client';

import { useState, useTransition } from 'react';
import { Button } from '@hmp/ui';
import type { DeadlineStage } from '@hmp/db';
import { DateField } from './date-field';
import { setDeadlineAction } from '@/app/(shared)/deadline-actions';

/** v1.4.2 — change one step's due date on one request, with a reason (or put it back to the usual rule). */
export function ChangeDeadline({
  requestId,
  stage,
  label,
  current,
  manual,
}: {
  requestId: string;
  stage: DeadlineStage;
  label: string;
  current: string;
  manual: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [dueOn, setDueOn] = useState(current);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = (clear: boolean) =>
    start(async () => {
      setError(null);
      const fd = new FormData();
      fd.set('requestId', requestId);
      fd.set('stage', stage);
      fd.set('dueOn', clear ? '' : dueOn);
      fd.set('reason', reason);
      const r = await setDeadlineAction(fd);
      if ('error' in r) setError(r.error);
      else setOpen(false);
    });

  if (!open)
    return (
      <button
        className="text-xs underline"
        onClick={() => setOpen(true)}
        data-testid="deadline-change"
      >
        Change
      </button>
    );
  return (
    <div className="space-y-2 rounded-md border bg-white p-2 text-left" data-testid="deadline-form">
      <div className="text-xs font-medium">{label} — new due date</div>
      <DateField
        id={`due-${stage}`}
        value={dueOn}
        onChange={setDueOn}
        aria-label={`${label} due date`}
      />
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Why? (shown on the request)"
        aria-label="Reason"
        className="bg-background h-8 w-full rounded-md border px-2 text-xs"
      />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={pending} onClick={() => save(false)}>
          Save
        </Button>
        {manual ? (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => save(true)}>
            Back to the usual date
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </div>
  );
}

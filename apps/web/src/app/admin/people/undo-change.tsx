'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@hmp/ui';
import { undoPersonChangeAction } from './actions';

/** v1.4.2 — "Changed by Asha on 12 Nov 10:40 … Undo (until 13 Nov 10:40)". */
export function UndoChange({
  userId,
  auditId,
  text,
  changes,
  handedOver,
  until,
}: {
  userId: string;
  auditId: string;
  text: string;
  changes: string[];
  handedOver: number;
  until: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  if (done)
    return (
      <p
        className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
        role="status"
      >
        Undone. Their menu changes on their next page.
      </p>
    );
  return (
    <div
      className="mb-4 space-y-1.5 rounded-md border border-sky-300 bg-sky-50 px-3 py-2.5 text-sm text-sky-950"
      data-testid="undo-change"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          <strong>{text}</strong>: {changes.join(' · ')}
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const r = await undoPersonChangeAction(userId, auditId);
              if (r.ok) {
                setDone(true);
                // Reopen the page: fresh roles in the form, and the "Undone" note.
                router.replace(`${window.location.pathname}?undone=1`);
                router.refresh();
              } else setError(r.error);
            })
          }
          data-testid="undo-button"
        >
          Undo
        </Button>
      </div>
      <div className="text-xs">
        Possible until {until}.
        {handedOver > 0
          ? ` The ${handedOver} handout${handedOver === 1 ? '' : 's'} handed over in that change stay with the new person — change them on each request if needed.`
          : ''}
      </div>
      {error ? <p className="text-xs text-red-700">{error}</p> : null}
    </div>
  );
}

'use client';

import { useState, useTransition } from 'react';
import { Button, Label } from '@hmp/ui';
import {
  acceptNominationAction,
  declineNominationAction,
  markNominationCompleteAction,
} from './actions';

const REASON_MAX = 500;

interface Props {
  nominationId: string;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'COMPLETED';
  smeHasCommented: boolean;
}

export function NominationResponsePanel({ nominationId, status, smeHasCommented }: Props) {
  const [reason, setReason] = useState('');
  const [showDecline, setShowDecline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const reset = () => {
    setError(null);
    setSuccess(null);
  };

  const accept = () => {
    reset();
    const fd = new FormData();
    fd.set('nominationId', nominationId);
    startTransition(async () => {
      const r = await acceptNominationAction(fd);
      if ('error' in r) setError(r.error);
      else setSuccess('Nomination accepted. You can now comment on the handout.');
    });
  };

  const submitDecline = () => {
    reset();
    if (reason.trim().length === 0) {
      setError('Please provide a reason for declining.');
      return;
    }
    const fd = new FormData();
    fd.set('nominationId', nominationId);
    fd.set('reason', reason);
    startTransition(async () => {
      const r = await declineNominationAction(fd);
      if ('error' in r) setError(r.error);
      else {
        setSuccess('Nomination declined. The PC has been notified.');
        setReason('');
        setShowDecline(false);
      }
    });
  };

  const complete = () => {
    reset();
    const fd = new FormData();
    fd.set('nominationId', nominationId);
    startTransition(async () => {
      const r = await markNominationCompleteAction(fd);
      if ('error' in r) setError(r.error);
      else setSuccess('Nomination marked complete. Thank you for your advisory input.');
    });
  };

  if (status === 'PENDING') {
    return (
      <div className="space-y-3">
        {!showDecline ? (
          <div className="flex flex-wrap gap-2">
            <Button onClick={accept} disabled={pending}>
              {pending ? 'Working…' : 'Accept nomination'}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                reset();
                setShowDecline(true);
              }}
              disabled={pending}
            >
              Decline
            </Button>
          </div>
        ) : (
          <div className="space-y-2 rounded-md border bg-muted/30 p-3">
            <Label htmlFor="decline-reason">
              Reason for declining{' '}
              <span className="text-muted-foreground text-xs">
                ({reason.length}/{REASON_MAX})
              </span>
            </Label>
            <textarea
              id="decline-reason"
              value={reason}
              maxLength={REASON_MAX}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Out of expertise, scheduling conflict, etc."
              className="bg-background min-h-[80px] w-full rounded-md border p-2 text-sm"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="destructive"
                onClick={submitDecline}
                disabled={pending || reason.trim().length === 0}
              >
                {pending ? 'Working…' : 'Confirm decline'}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setShowDecline(false);
                  setReason('');
                  setError(null);
                }}
                disabled={pending}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
        {error && <p className="text-destructive text-sm">{error}</p>}
        {success && <p className="text-sm text-emerald-600">{success}</p>}
      </div>
    );
  }

  if (status === 'ACCEPTED') {
    return (
      <div className="space-y-2">
        <p className="text-muted-foreground text-sm">
          You&apos;ve accepted this nomination. Add comments below with your advisory input, then
          mark it complete when you&apos;re done.
        </p>
        <Button onClick={complete} disabled={pending || !smeHasCommented}>
          {pending ? 'Working…' : 'Mark nomination complete'}
        </Button>
        {!smeHasCommented && (
          <p className="text-muted-foreground text-xs">
            Tip: add at least one comment before marking complete.
          </p>
        )}
        {error && <p className="text-destructive text-sm">{error}</p>}
        {success && <p className="text-sm text-emerald-600">{success}</p>}
      </div>
    );
  }

  // DECLINED or COMPLETED — no further actions.
  return (
    <p className="text-muted-foreground text-sm">
      This nomination is {status.toLowerCase()}. No further actions are available.
    </p>
  );
}

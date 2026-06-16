'use client';

import { useState, useTransition } from 'react';
import { Button, Label } from '@hmp/ui';
import { confirmAssignmentAction, pcRejectAllocationAction } from './actions';

/**
 * PC allocation review (Prompt 22). PC confirms HOG's allocation (→ ASSIGNED,
 * faculty work begins) OR rejects it (→ REQUESTED, back to HOG to re-allocate).
 * The comment is optional for confirm, REQUIRED for reject.
 */
export function AssignmentPanel({ requestId }: { requestId: string }) {
  const [comments, setComments] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<'confirmed' | 'rejected' | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (action: typeof confirmAssignmentAction, outcome: 'confirmed' | 'rejected') => {
    setError(null);
    const fd = new FormData();
    fd.set('requestId', requestId);
    fd.set('comments', comments);
    startTransition(async () => {
      const r = await action(fd);
      if (r?.error) setError(r.error);
      else setDone(outcome);
    });
  };

  const confirm = () => run(confirmAssignmentAction, 'confirmed');
  const reject = () => {
    // Client-side guard for UX — the server enforces it too (reworkSchema).
    if (comments.trim().length < 3) {
      setError('A reject reason is required (at least 3 characters).');
      return;
    }
    run(pcRejectAllocationAction, 'rejected');
  };

  if (done === 'confirmed') {
    return (
      <p className="text-sm text-emerald-600" data-testid="assignment-success">
        Allocation confirmed. Status moved to ASSIGNED — the faculty can now begin work.
      </p>
    );
  }
  if (done === 'rejected') {
    return (
      <p className="text-sm text-amber-600" data-testid="assignment-success">
        Allocation rejected. Sent back to HOG (status REQUESTED) for re-allocation.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2">
        <Label htmlFor="comments">Comments (optional to confirm · required to reject)</Label>
        <textarea
          id="comments"
          data-testid="assignment-comments"
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          className="bg-background min-h-[80px] rounded-md border p-2 text-sm"
          placeholder="e.g. SME lacks expertise in distributed systems for this course"
        />
      </div>
      {error && (
        <p className="text-destructive text-sm" data-testid="assignment-error">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button onClick={confirm} disabled={pending} data-testid="confirm-assignment-btn">
          {pending ? 'Working…' : 'Confirm allocation'}
        </Button>
        <Button
          variant="outline"
          onClick={reject}
          disabled={pending}
          data-testid="reject-allocation-btn"
        >
          Reject allocation
        </Button>
      </div>
    </div>
  );
}

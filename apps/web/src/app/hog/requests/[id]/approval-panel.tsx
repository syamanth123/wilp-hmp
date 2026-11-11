'use client';

import { useState, useTransition } from 'react';
import { Button, Label } from '@hmp/ui';
import { finalApproveAction, finalRejectAction, hogRequestReworkAction } from './actions';

type Action = 'approve' | 'rework' | 'reject';

export function FinalApprovalPanel({ requestId }: { requestId: string }) {
  const [comments, setComments] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (kind: Action) => {
    setError(null);
    setSuccess(null);
    const fd = new FormData();
    fd.set('requestId', requestId);
    fd.set('comments', comments);
    startTransition(async () => {
      const fn =
        kind === 'approve'
          ? finalApproveAction
          : kind === 'rework'
            ? hogRequestReworkAction
            : finalRejectAction;
      const r = await fn(fd);
      if (r?.error) setError(r.error);
      else
        setSuccess(
          `Request ${kind === 'approve' ? 'approved' : kind === 'rework' ? 'sent back for rework' : 'rejected'}.`,
        );
    });
  };

  if (success) return <p className="text-sm text-emerald-600">{success}</p>;

  return (
    <div className="space-y-3">
      <div className="grid gap-2">
        <Label htmlFor="comments">Comments (required for rework/reject)</Label>
        <textarea
          data-shortcut="comment"
          id="comments"
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          className="bg-background min-h-[80px] rounded-md border p-2 text-sm"
        />
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => run('approve')} disabled={pending} data-shortcut="approve">
          Approve (final)
        </Button>
        <Button variant="outline" onClick={() => run('rework')} disabled={pending}>
          Request rework
        </Button>
        <Button variant="destructive" onClick={() => run('reject')} disabled={pending}>
          Reject
        </Button>
      </div>
    </div>
  );
}

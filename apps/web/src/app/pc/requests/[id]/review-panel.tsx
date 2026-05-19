'use client';

import { useState, useTransition } from 'react';
import { Button, Label } from '@hmp/ui';
import { pcReviewApproveAction, pcReviewReworkAction } from './actions';

type Action = 'approve' | 'rework';

export function ReviewPanel({ requestId }: { requestId: string }) {
  const [comments, setComments] = useState('');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const trimmedComments = comments.trim();
  const reworkDisabled = pending || trimmedComments.length === 0;
  const showReworkHint = touched && trimmedComments.length === 0;

  const run = (kind: Action) => {
    setError(null);
    setSuccess(null);
    const fd = new FormData();
    fd.set('requestId', requestId);
    fd.set('comments', comments);
    startTransition(async () => {
      const fn = kind === 'approve' ? pcReviewApproveAction : pcReviewReworkAction;
      const r = await fn(fd);
      if (r?.error) setError(r.error);
      else setSuccess(kind === 'approve' ? 'Forwarded to HOG for final approval.' : 'Sent back to faculty for rework.');
    });
  };

  if (success) return <p className="text-sm text-emerald-600">{success}</p>;

  return (
    <div className="space-y-3">
      <div className="grid gap-2">
        <Label htmlFor="comments">Comments (required for rework)</Label>
        <textarea
          id="comments"
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          onBlur={() => setTouched(true)}
          aria-describedby={showReworkHint ? 'comments-hint' : undefined}
          className="min-h-[80px] rounded-md border bg-background p-2 text-sm"
        />
        {showReworkHint && (
          <p id="comments-hint" className="text-xs" style={{ color: 'var(--warn)' }}>
            Comments are required when requesting rework.
          </p>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => run('approve')} disabled={pending}>
          Approve & forward
        </Button>
        <Button
          variant="outline"
          onClick={() => run('rework')}
          disabled={reworkDisabled}
          title={reworkDisabled && !pending ? 'Add comments to request rework' : undefined}
        >
          Request rework
        </Button>
      </div>
    </div>
  );
}

'use client';

import { useState, useTransition } from 'react';
import { Button, Label } from '@hmp/ui';
import { smeApproveAction, smeRevertAction } from './actions';

type Action = 'approve' | 'revert';

/**
 * SME approve / request-changes panel (Prompt 12-b). Mirrors the PC
 * review-panel affordance hierarchy for cross-role consistency: "Approve" is
 * the primary button; "Request changes" is `variant="outline"`, disabled
 * until a comment is present, with a hint — same shape as
 * pc/requests/[id]/review-panel.tsx.
 */
export function SmeReviewPanel({ requestId }: { requestId: string }) {
  const [comment, setComment] = useState('');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const trimmed = comment.trim();
  const revertDisabled = pending || trimmed.length === 0;
  const showRevertHint = touched && trimmed.length === 0;

  const run = (kind: Action) => {
    setError(null);
    setSuccess(null);
    const fd = new FormData();
    fd.set('requestId', requestId);
    if (kind === 'revert') fd.set('comments', comment);
    startTransition(async () => {
      const fn = kind === 'approve' ? smeApproveAction : smeRevertAction;
      const r = await fn(fd);
      if ('error' in r && r.error) setError(r.error);
      else
        setSuccess(
          kind === 'approve'
            ? 'Approved — forwarded to the Programme Committee.'
            : 'Sent back to faculty with your comment.',
        );
    });
  };

  if (success) return <p className="text-sm text-emerald-600">{success}</p>;

  return (
    <div className="space-y-3">
      <div className="grid gap-2">
        <Label htmlFor="sme-comment">Comment (required to request changes)</Label>
        <textarea
          id="sme-comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          onBlur={() => setTouched(true)}
          aria-describedby={showRevertHint ? 'sme-comment-hint' : undefined}
          className="bg-background min-h-[80px] rounded-md border p-2 text-sm"
          data-testid="sme-revert-comment"
        />
        {showRevertHint && (
          <p id="sme-comment-hint" className="text-xs" style={{ color: 'var(--warn)' }}>
            A comment is required when requesting changes.
          </p>
        )}
      </div>
      {error && (
        <p className="text-destructive text-sm" data-testid="sme-review-error">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => run('approve')} disabled={pending} data-testid="sme-approve-button">
          Approve
        </Button>
        <Button
          variant="outline"
          onClick={() => run('revert')}
          disabled={revertDisabled}
          title={revertDisabled && !pending ? 'Add a comment to request changes' : undefined}
          data-testid="sme-revert-button"
        >
          Request changes
        </Button>
      </div>
    </div>
  );
}

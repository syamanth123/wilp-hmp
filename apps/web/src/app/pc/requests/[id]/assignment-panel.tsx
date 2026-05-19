'use client';

import { useState, useTransition } from 'react';
import { Button, Label } from '@hmp/ui';
import { confirmAssignmentAction } from './actions';

export function AssignmentPanel({ requestId }: { requestId: string }) {
  const [comments, setComments] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    const fd = new FormData();
    fd.set('requestId', requestId);
    fd.set('comments', comments);
    startTransition(async () => {
      const r = await confirmAssignmentAction(fd);
      if (r?.error) setError(r.error);
      else setSuccess(true);
    });
  };

  if (success) {
    return <p className="text-sm text-emerald-600">Assignment confirmed. Status moved to ASSIGNED.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2">
        <Label htmlFor="comments">Comments (optional)</Label>
        <textarea
          id="comments"
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          className="min-h-[80px] rounded-md border bg-background p-2 text-sm"
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button onClick={submit} disabled={pending}>
        {pending ? 'Confirming…' : 'Confirm assignment'}
      </Button>
    </div>
  );
}

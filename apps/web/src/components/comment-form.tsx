'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Label } from '@hmp/ui';
import { addCommentAction } from '@/app/(shared)/comment-actions';

export function CommentForm({ requestId }: { requestId: string }) {
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const submit = () => {
    setError(null);
    const fd = new FormData();
    fd.set('requestId', requestId);
    fd.set('body', body);
    startTransition(async () => {
      const r = await addCommentAction(fd);
      if (r?.error) setError(r.error);
      else {
        setBody('');
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-2">
      <Label htmlFor="comment-body">Add a comment</Label>
      <textarea
        id="comment-body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Visible to IC, HOG, PC and the assigned faculty."
        className="min-h-[80px] w-full rounded-md border bg-background p-2 text-sm"
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div>
        <Button onClick={submit} disabled={pending || body.trim().length === 0}>
          {pending ? 'Posting…' : 'Post comment'}
        </Button>
      </div>
    </div>
  );
}

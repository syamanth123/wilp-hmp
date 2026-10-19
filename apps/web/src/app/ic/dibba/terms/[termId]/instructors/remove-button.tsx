'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@hmp/ui';
import { removeInstructorAction } from './actions';

/** Remove one instructor row (any source). Errors shown inline. */
export function RemoveInstructorButton({
  id,
  termId,
  who,
}: {
  id: string;
  termId: string;
  who: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const remove = () => {
    if (!window.confirm(`Remove ${who} from this course for the term?`)) return;
    setError(null);
    const fd = new FormData();
    fd.set('id', id);
    fd.set('termId', termId);
    startTransition(async () => {
      const r = await removeInstructorAction(fd);
      if ('error' in r) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        variant="ghost"
        size="sm"
        onClick={remove}
        disabled={pending}
        data-testid={`dibba-instructor-remove-${id}`}
      >
        {pending ? 'Removing…' : 'Remove'}
      </Button>
      {error && (
        <span className="text-destructive text-xs" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}

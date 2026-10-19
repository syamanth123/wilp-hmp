'use client';

import { useState, useTransition } from 'react';
import { Button } from '@hmp/ui';
import { discardDraftAction } from './actions';

/** Discard a DRAFT import (plan D9). Errors are shown inline, never swallowed. */
export function DiscardDraftButton({ importId, label }: { importId: string; label: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const discard = () => {
    if (
      !window.confirm(
        `Discard the draft '${label}'? Its parsed rows are deleted; the uploaded file is not affected.`,
      )
    ) {
      return;
    }
    setError(null);
    const fd = new FormData();
    fd.set('importId', importId);
    startTransition(async () => {
      const r = await discardDraftAction(fd);
      if ('error' in r) setError(r.error);
    });
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        variant="ghost"
        size="sm"
        onClick={discard}
        disabled={pending}
        data-testid={`dibba-discard-${importId}`}
      >
        {pending ? 'Discarding…' : 'Discard'}
      </Button>
      {error && (
        <span className="text-destructive text-xs" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}

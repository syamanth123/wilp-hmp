'use client';

import { useState, useTransition } from 'react';
import { Button } from '@hmp/ui';
import { archiveAction } from './actions';

export function ArchivePanel({ requestId }: { requestId: string }) {
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = () => {
    setError(null);
    setSuccess(null);
    const fd = new FormData();
    fd.set('requestId', requestId);
    startTransition(async () => {
      const r = await archiveAction(fd);
      if (r?.error) setError(r.error);
      else setSuccess('Archived.');
    });
  };

  if (success) return <p className="text-sm text-emerald-600">{success}</p>;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Archiving moves the handout to read-only state. Use this at the end of the term.
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        I understand this moves the handout to ARCHIVED.
      </label>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button variant="outline" onClick={run} disabled={pending || !confirmed}>
        {pending ? 'Archiving…' : 'Archive this handout'}
      </Button>
    </div>
  );
}

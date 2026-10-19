'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@hmp/ui';
import { publishImportAction } from './actions';

/**
 * Publish step (plan §1.6, D6): states exactly what will happen — which draft
 * becomes the term's schedule and which published import gets superseded —
 * and, when the parser raised warnings that need confirmation, requires the
 * IC to tick that they reviewed them (there is no acknowledgement column;
 * publishing IS the acknowledgement). Errors render inline (plan D11).
 */
interface Props {
  importId: string;
  label: string;
  termName: string;
  rowCount: string; // pre-formatted ("1,077") so the copy matches the counts strip
  acknowledgeCount: number;
  currentPublished: { label: string; publishedAt: string | null } | null;
}

export function PublishPanel({
  importId,
  label,
  termName,
  rowCount,
  acknowledgeCount,
  currentPublished,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [reviewed, setReviewed] = useState(acknowledgeCount === 0);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  const publish = () => {
    setError(null);
    const fd = new FormData();
    fd.set('importId', importId);
    startTransition(async () => {
      const r = await publishImportAction(fd);
      if ('error' in r) {
        setError(r.error);
        return;
      }
      setDone(r.supersededCount);
      router.refresh();
    });
  };

  if (done !== null) {
    return (
      <div
        className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800"
        data-testid="dibba-publish-done"
      >
        ✓ Published &lsquo;{label}&rsquo; as the schedule for {termName}
        {done > 0 ? ` — the previous published import was marked superseded.` : '.'}
      </div>
    );
  }

  return (
    <div
      className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3"
      data-testid="dibba-publish"
    >
      <p className="text-sm font-semibold">
        Publish &lsquo;{label}&rsquo; as the schedule for {termName} ({rowCount} rows)
      </p>
      {currentPublished ? (
        <p className="text-muted-foreground text-xs">
          The current published import &lsquo;{currentPublished.label}&rsquo;
          {currentPublished.publishedAt ? ` (published ${currentPublished.publishedAt})` : ''} will
          be marked <strong>superseded</strong>. Faculty and HOG screens read the published import
          only.
        </p>
      ) : (
        <p className="text-muted-foreground text-xs">
          This term has no published Dibba yet; this import becomes it.
        </p>
      )}
      {acknowledgeCount > 0 && (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={reviewed}
            onChange={(e) => setReviewed(e.target.checked)}
            disabled={pending}
            className="mt-0.5"
            data-testid="dibba-publish-confirm"
          />
          <span>
            I have reviewed the {acknowledgeCount} warning{acknowledgeCount === 1 ? '' : 's'} that
            need confirmation (listed above) against the printed Dibba.
          </span>
        </label>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={publish}
          disabled={pending || !reviewed}
          data-testid="dibba-publish-button"
        >
          {pending ? 'Publishing…' : 'Publish'}
        </Button>
        {error && (
          <span className="text-destructive text-sm" role="alert" data-testid="dibba-publish-error">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}

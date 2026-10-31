'use client';

import { useState, useTransition } from 'react';
import { Button } from '@hmp/ui';
import {
  reParseImportAction,
  deleteImportAction,
  approveImportAction,
  rejectImportAction,
} from './actions';

interface Props {
  id: string;
  approvedForReuse: boolean;
}

/**
 * Per-row actions for `/admin/corpus-imports`. 11f-a shipped Re-parse +
 * Delete; 11f-b2 adds Approve + Reject for the approval workflow.
 *
 * Approve: sets approvedForReuse=true (no eligibility gate — admin judgment
 *   overrides the bulk-approve filter).
 * Reject: deletes the row (alias for Delete, semantically named for the
 *   approval workflow).
 */
type ActionResult = { error?: string } | Record<string, unknown>;

export function RowActions({ id, approvedForReuse }: Props) {
  const [pending, startTransition] = useTransition();
  // A failed action used to go only to the browser console, so the button
  // looked dead. Now the reason is shown next to the row.
  const [failure, setFailure] = useState<string | null>(null);

  const run = (verb: string, action: (fd: FormData) => Promise<ActionResult>) => {
    const fd = new FormData();
    fd.set('id', id);
    setFailure(null);
    startTransition(async () => {
      try {
        const r = await action(fd);
        const err = 'error' in r && typeof r.error === 'string' ? r.error : null;
        if (err) setFailure(`Couldn't ${verb}: ${err}`);
      } catch {
        setFailure(`Couldn't ${verb}. Please try again.`);
      }
    });
  };

  const approve = () => run('approve this handout', approveImportAction);

  const reject = () => {
    if (
      !window.confirm(
        'Reject this handout? It is removed from the library; the original Word file is kept.',
      )
    )
      return;
    run('reject this handout', rejectImportAction);
  };

  const reparse = () => run('read the file again', reParseImportAction);

  const remove = () => {
    if (!window.confirm('Remove this handout from the library? The original Word file is kept.'))
      return;
    run('remove this handout', deleteImportAction);
  };

  return (
    <div>
      <div className="flex gap-1">
        {approvedForReuse ? (
          <span
            className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700"
            data-testid="corpus-row-approved-badge"
          >
            ✓ Approved
          </span>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={approve}
            disabled={pending}
            data-testid="corpus-row-approve"
          >
            Approve for reuse
          </Button>
        )}
        {!approvedForReuse && (
          <Button
            variant="ghost"
            size="sm"
            onClick={reject}
            disabled={pending}
            data-testid="corpus-row-reject"
          >
            Reject
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={reparse} disabled={pending}>
          Read file again
        </Button>
        <Button variant="ghost" size="sm" onClick={remove} disabled={pending}>
          Remove
        </Button>
      </div>
      {failure ? (
        <p className="text-destructive mt-1 text-xs" role="alert" data-testid="corpus-row-error">
          {failure}
        </p>
      ) : null}
    </div>
  );
}

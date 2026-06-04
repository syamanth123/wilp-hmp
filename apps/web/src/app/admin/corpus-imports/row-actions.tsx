'use client';

import { useTransition } from 'react';
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
export function RowActions({ id, approvedForReuse }: Props) {
  const [pending, startTransition] = useTransition();

  const approve = () => {
    const fd = new FormData();
    fd.set('id', id);
    startTransition(async () => {
      const r = await approveImportAction(fd);
      if ('error' in r && r.error) console.error('approve_failed', r.error);
    });
  };

  const reject = () => {
    if (!window.confirm('Reject this import? The row will be deleted; source file is not touched.'))
      return;
    const fd = new FormData();
    fd.set('id', id);
    startTransition(async () => {
      const r = await rejectImportAction(fd);
      if ('error' in r && r.error) console.error('reject_failed', r.error);
    });
  };

  const reparse = () => {
    const fd = new FormData();
    fd.set('id', id);
    startTransition(async () => {
      const r = await reParseImportAction(fd);
      if ('error' in r && r.error) console.error('reparse_failed', r.error);
    });
  };

  const remove = () => {
    if (!window.confirm('Delete this import row? The source file is not touched.')) return;
    const fd = new FormData();
    fd.set('id', id);
    startTransition(async () => {
      const r = await deleteImportAction(fd);
      if ('error' in r && r.error) console.error('delete_failed', r.error);
    });
  };

  return (
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
          Approve
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
        Re-parse
      </Button>
      <Button variant="ghost" size="sm" onClick={remove} disabled={pending}>
        Delete
      </Button>
    </div>
  );
}

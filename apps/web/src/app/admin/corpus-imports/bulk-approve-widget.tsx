'use client';

import { useState, useTransition } from 'react';
import { Button } from '@hmp/ui';
import { countBulkApproveEligibleAction, bulkApproveEligibleAction } from './actions';

/**
 * Bulk-approve flow (Prompt 11f-b2). Two-step:
 *
 *   1. Click "Approve all clean imports" → call countBulkApproveEligibleAction
 *      to get the live eligible count + a sample of course numbers.
 *   2. Confirmation dialog shows count + sample + warning. Click "Confirm"
 *      → call bulkApproveEligibleAction which does the actual UPDATE.
 *
 * The two-step shape catches state-sync drift: the dialog says "Approve
 * 230 imports"; if another admin approves some between dialog and confirm,
 * the action result reports a different count and we surface that. Theatre-
 * level confirmations ("Are you sure?") are useless; this one shows what's
 * actually about to happen.
 */
export function BulkApproveWidget() {
  const [pending, startTransition] = useTransition();
  const [step, setStep] = useState<'idle' | 'confirm' | 'done'>('idle');
  const [eligibleCount, setEligibleCount] = useState(0);
  const [sample, setSample] = useState<string[]>([]);
  const [approvedCount, setApprovedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const openConfirm = () => {
    setError(null);
    startTransition(async () => {
      const r = await countBulkApproveEligibleAction();
      if ('error' in r) {
        setError(r.error as string);
        return;
      }
      setEligibleCount(r.eligibleCount);
      setSample(r.sampleCourseNumbers);
      setStep('confirm');
    });
  };

  const confirm = () => {
    startTransition(async () => {
      const r = await bulkApproveEligibleAction();
      if ('error' in r) {
        setError(r.error as string);
        return;
      }
      setApprovedCount(r.approvedCount);
      setStep('done');
    });
  };

  if (step === 'done') {
    return (
      <div
        className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm"
        data-testid="corpus-bulk-approve-done"
      >
        <strong>Approved {approvedCount} imports.</strong> They&apos;re now available to faculty via
        auto-fetch Tier 2 for matching course codes.
        <button
          type="button"
          onClick={() => setStep('idle')}
          className="ml-3 underline"
          data-testid="corpus-bulk-approve-reset"
        >
          Dismiss
        </button>
      </div>
    );
  }

  if (step === 'confirm') {
    return (
      <div
        className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3"
        data-testid="corpus-bulk-approve-confirm"
      >
        <div>
          <p className="text-sm font-semibold">
            Approve {eligibleCount} imports for faculty re-use?
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            Eligibility: MAMMOTH_STRUCTURED, ≤1 parseWarning, course number identified, not yet
            approved. Approved imports become available via auto-fetch Tier 2 the next time faculty
            starts a new handout for a matching course code.
          </p>
        </div>
        {sample.length > 0 && (
          <div className="text-xs">
            <p className="text-muted-foreground">First {sample.length} course numbers (sample):</p>
            <p className="mt-1 font-mono">{sample.join(', ')}</p>
          </div>
        )}
        <div className="flex gap-2">
          <Button
            onClick={confirm}
            disabled={pending || eligibleCount === 0}
            data-testid="corpus-bulk-approve-confirm-button"
          >
            {pending ? 'Approving…' : `Confirm — approve ${eligibleCount}`}
          </Button>
          <Button variant="outline" onClick={() => setStep('idle')} disabled={pending}>
            Cancel
          </Button>
        </div>
        {error && (
          <p className="text-destructive text-sm" data-testid="corpus-bulk-approve-error">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3" data-testid="corpus-bulk-approve-widget">
      <Button onClick={openConfirm} disabled={pending} data-testid="corpus-bulk-approve-open">
        {pending ? 'Counting…' : 'Approve all clean imports'}
      </Button>
      <span className="text-muted-foreground text-xs">
        MAMMOTH_STRUCTURED + ≤1 warning + course identified, not yet approved
      </span>
      {error && (
        <p className="text-destructive text-sm" data-testid="corpus-bulk-approve-error">
          {error}
        </p>
      )}
    </div>
  );
}

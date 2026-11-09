'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@hmp/ui';

export interface HandoverCandidate {
  id: string;
  name: string;
  departmentName: string | null;
  load: string;
  sameDepartment: boolean;
}

/**
 * v1.4.1 §A4: shows who is the request's HOG / PC and lets the IC (HOG) or the HOG (PC) hand it to
 * someone else, with a reason. Own department first; others marked "other dept".
 */
export function HandoverPanel({
  requestId,
  roleLabel,
  current,
  candidates,
  action,
  canChange,
}: {
  requestId: string;
  /** "HOG" or "PC" */
  roleLabel: string;
  current: { name: string; departmentName: string | null } | null;
  candidates: HandoverCandidate[];
  action: (fd: FormData) => Promise<{ ok?: true; error?: string }>;
  canChange: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const key = roleLabel.toLowerCase();

  const save = () => {
    setError(null);
    const fd = new FormData();
    fd.set('requestId', requestId);
    fd.set('toUserId', to);
    fd.set('reason', reason);
    start(async () => {
      const r = await action(fd);
      if (r.error) return setError(r.error);
      setOpen(false);
      setTo('');
      setReason('');
      router.refresh();
    });
  };

  return (
    <div className="space-y-2 text-sm" data-testid={`handover-${key}`}>
      <p>
        <span className="text-muted-foreground">{roleLabel}:</span>{' '}
        {current ? (
          <strong data-testid={`handover-${key}-current`}>
            {current.name}
            {current.departmentName ? ` (${current.departmentName})` : ''}
          </strong>
        ) : (
          <span className="text-amber-800" data-testid={`handover-${key}-current`}>
            not recorded yet
          </span>
        )}{' '}
        {canChange && !open && (
          <button
            type="button"
            className="underline"
            onClick={() => setOpen(true)}
            data-testid={`handover-${key}-open`}
          >
            Change
          </button>
        )}
      </p>
      {open && (
        <div className="space-y-2 rounded-md border p-3">
          <select
            className="bg-background h-9 w-full rounded-md border px-2"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            aria-label={`New ${roleLabel}`}
            data-testid={`handover-${key}-to`}
          >
            <option value="">Choose the new {roleLabel}…</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} — {c.departmentName ?? 'no department'} · {c.load}
                {c.sameDepartment ? '' : ' (other dept)'}
              </option>
            ))}
          </select>
          <textarea
            className="bg-background min-h-[60px] w-full rounded-md border p-2"
            placeholder="Why? e.g. Dr X is on leave until 20 Nov"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-label="Reason"
            data-testid={`handover-${key}-reason`}
          />
          {error && (
            <p className="text-destructive" role="alert">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              onClick={save}
              disabled={pending || !to || reason.trim().length < 5}
              data-testid={`handover-${key}-save`}
            >
              {pending ? 'Saving…' : `Hand over`}
            </Button>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            Both the previous and the new {roleLabel} are told. The request history keeps both
            names.
          </p>
        </div>
      )}
    </div>
  );
}

'use client';

import { useState, useTransition } from 'react';
import { Badge, Button, Input, Label } from '@hmp/ui';
import { nominateSmeAction } from './actions';

export interface SmeOption {
  id: string;
  name: string;
  email: string;
}

export interface ExistingNomination {
  id: string;
  topic: string;
  notes: string | null;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'COMPLETED';
  createdAt: string; // ISO string (server-serialised for the client)
  smeUser: { name: string; email: string };
  nominatedBy: { name: string };
}

const STATUS_BADGE_VARIANT: Record<
  ExistingNomination['status'],
  'secondary' | 'success' | 'destructive' | 'outline'
> = {
  PENDING: 'secondary',
  ACCEPTED: 'success',
  DECLINED: 'destructive',
  COMPLETED: 'outline',
};

const TOPIC_MAX = 200;
const NOTES_MAX = 2000;

export function SmeNominationsPanel({
  requestId,
  canNominate,
  smeOptions,
  nominations,
}: {
  requestId: string;
  canNominate: boolean;
  smeOptions: SmeOption[];
  nominations: ExistingNomination[];
}) {
  const [smeUserId, setSmeUserId] = useState('');
  const [topic, setTopic] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    setSuccess(null);
    if (!smeUserId) {
      setError('Pick an SME');
      return;
    }
    if (topic.trim().length === 0) {
      setError('Topic is required');
      return;
    }
    const fd = new FormData();
    fd.set('requestId', requestId);
    fd.set('smeUserId', smeUserId);
    fd.set('topic', topic);
    fd.set('notes', notes);
    startTransition(async () => {
      const r = await nominateSmeAction(fd);
      if ('error' in r) {
        setError(r.error);
      } else {
        setSuccess('Nomination created. The SME has been notified.');
        setSmeUserId('');
        setTopic('');
        setNotes('');
      }
    });
  };

  return (
    <div className="space-y-4">
      {/* Existing nominations list */}
      {nominations.length === 0 ? (
        <p className="text-sm text-muted-foreground">No nominations yet.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {nominations.map((n) => (
            <li key={n.id} className="flex items-start justify-between gap-3 p-3 text-sm">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{n.smeUser.name}</span>
                  <span className="text-xs text-muted-foreground">{n.smeUser.email}</span>
                  <Badge variant={STATUS_BADGE_VARIANT[n.status]}>{n.status}</Badge>
                </div>
                <div className="mt-1 text-sm">{n.topic}</div>
                {n.notes && (
                  <div className="mt-1 text-xs text-muted-foreground line-clamp-2">{n.notes}</div>
                )}
              </div>
              <div className="text-right text-xs text-muted-foreground flex-shrink-0">
                <div>by {n.nominatedBy.name}</div>
                <div>{new Date(n.createdAt).toLocaleDateString()}</div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Form — only when current status accepts nominations AND we have SMEs */}
      {canNominate && smeOptions.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No SME users available in the system — ask an admin to create one.
        </p>
      )}
      {canNominate && smeOptions.length > 0 && (
        <div className="space-y-3 rounded-md border bg-muted/30 p-3">
          <div className="grid gap-2">
            <Label htmlFor="sme-user">SME</Label>
            <select
              id="sme-user"
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={smeUserId}
              onChange={(e) => setSmeUserId(e.target.value)}
            >
              <option value="">Select an SME…</option>
              {smeOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} — {o.email}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="sme-topic">
              Topic{' '}
              <span className="text-xs text-muted-foreground">
                ({topic.length}/{TOPIC_MAX})
              </span>
            </Label>
            <Input
              id="sme-topic"
              type="text"
              value={topic}
              maxLength={TOPIC_MAX}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. Industry perspective on architectures"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="sme-notes">
              Notes (optional){' '}
              <span className="text-xs text-muted-foreground">
                ({notes.length}/{NOTES_MAX})
              </span>
            </Label>
            <textarea
              id="sme-notes"
              value={notes}
              maxLength={NOTES_MAX}
              onChange={(e) => setNotes(e.target.value)}
              className="min-h-[80px] rounded-md border bg-background p-2 text-sm"
              placeholder="Context for the SME — what perspective are you looking for?"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {success && <p className="text-sm text-emerald-600">{success}</p>}

          <Button onClick={submit} disabled={pending || !smeUserId || topic.trim().length === 0}>
            {pending ? 'Nominating…' : 'Nominate SME'}
          </Button>
        </div>
      )}

      {!canNominate && (
        <p className="text-xs text-muted-foreground">
          Nominations are accepted only between ASSIGNED and UNDER_REVIEW.
        </p>
      )}
    </div>
  );
}

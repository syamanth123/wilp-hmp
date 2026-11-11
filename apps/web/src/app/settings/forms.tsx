'use client';

import { useState, useTransition } from 'react';
import { Button } from '@hmp/ui';
import { DateField } from '@/components/date-field';
import {
  endAwayAction,
  makeCalendarLinkAction,
  saveAwayAction,
  saveEmailAction,
  stopCalendarLinkAction,
} from './actions';

type Result = { ok: true; message?: string; link?: string } | { ok: false; error: string } | null;

function Feedback({ r }: { r: Result }) {
  if (!r) return null;
  return r.ok ? (
    <p className="text-sm text-emerald-800" role="status">
      {r.message}
    </p>
  ) : (
    <p className="text-sm text-red-700" role="alert">
      {r.error}
    </p>
  );
}

export interface BackupOption {
  id: string;
  name: string;
  department: string | null;
  sameDepartment: boolean;
  away: string | null;
}

export function AwayForm({
  from,
  until,
  backupId,
  options,
  needsBackup,
}: {
  from: string;
  until: string;
  backupId: string;
  options: BackupOption[];
  needsBackup: boolean;
}) {
  const [state, setState] = useState<Result>(null);
  const [pending, start] = useTransition();
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => setState(await saveAwayAction(null, fd)));
  };
  const own = options.filter((o) => o.sameDepartment);
  const others = options.filter((o) => !o.sameDepartment);
  const label = (o: BackupOption) =>
    `${o.name}${o.department && !o.sameDepartment ? ` (${o.department})` : ''}${o.away ? ` — ${o.away}` : ''}`;
  return (
    <form onSubmit={onSubmit} className="space-y-3" data-testid="away-form">
      <div className="flex flex-wrap gap-4">
        <div className="space-y-1">
          <label htmlFor="away-from" className="block text-sm font-medium">
            First day away{' '}
            <span className="text-muted-foreground font-normal">(empty = today)</span>
          </label>
          <DateField id="away-from" name="from" defaultValue={from} />
        </div>
        <div className="space-y-1">
          <label htmlFor="away-until" className="block text-sm font-medium">
            Last day away
          </label>
          <DateField id="away-until" name="until" defaultValue={until} required />
        </div>
      </div>
      {needsBackup ? (
        <div className="space-y-1">
          <label htmlFor="away-backup" className="block text-sm font-medium">
            Back-up
          </label>
          <select
            id="away-backup"
            name="backupId"
            defaultValue={backupId}
            className="bg-background h-9 w-full max-w-md rounded-md border px-2 text-sm"
            data-testid="away-backup"
          >
            <option value="">Pick a colleague with the same role…</option>
            {own.length ? (
              <optgroup label="Your department">
                {own.map((o) => (
                  <option key={o.id} value={o.id}>
                    {label(o)}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {others.length ? (
              <optgroup label="Other departments">
                {others.map((o) => (
                  <option key={o.id} value={o.id}>
                    {label(o)}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
          <p className="text-muted-foreground text-xs">
            While you are away, they see your requests, get your notices and reminders, and can act
            for you (recorded as &ldquo;for you&rdquo;). Nothing is moved: it is all yours again
            when you are back.
          </p>
        </div>
      ) : (
        <input type="hidden" name="backupId" value="" />
      )}
      <Button type="submit" size="sm" disabled={pending} data-testid="away-save">
        Save
      </Button>
      <Feedback r={state} />
    </form>
  );
}

export function EndAwayButton() {
  const [r, setR] = useState<Result>(null);
  const [pending, start] = useTransition();
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => start(async () => setR(await endAwayAction()))}
        data-testid="away-end"
      >
        I&apos;m back
      </Button>
      <Feedback r={r} />
    </span>
  );
}

export function EmailForm({
  emailMode,
  weeklySummary,
  showSummary,
}: {
  emailMode: 'INSTANT' | 'DIGEST';
  weeklySummary: boolean;
  showSummary: boolean;
}) {
  const [state, setState] = useState<Result>(null);
  const [pending, start] = useTransition();
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => setState(await saveEmailAction(null, fd)));
  };
  return (
    <form onSubmit={onSubmit} className="space-y-3" data-testid="email-form">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Emails about your handouts</legend>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name="emailMode"
            value="INSTANT"
            defaultChecked={emailMode === 'INSTANT'}
            className="mt-1"
          />
          <span>
            <strong>Each notice at once</strong> — as today.
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name="emailMode"
            value="DIGEST"
            defaultChecked={emailMode === 'DIGEST'}
            className="mt-1"
          />
          <span>
            <strong>One email a day at 09:00</strong> — everything from the last day in one list.
            Urgent ones still come at once: sent back for changes, overdue, and when someone
            @mentions you.
          </span>
        </label>
      </fieldset>
      {showSummary ? (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="weeklySummary"
            defaultChecked={weeklySummary}
            className="mt-1"
          />
          <span>
            <strong>Weekly summary</strong> on Monday at 09:00 — progress, overdue and published
            this week.
          </span>
        </label>
      ) : null}
      <p className="text-muted-foreground text-xs">
        Notices inside HMP (the bell) always arrive at once.
      </p>
      <Button type="submit" size="sm" disabled={pending} data-testid="email-save">
        Save
      </Button>
      <Feedback r={state} />
    </form>
  );
}

export function CalendarLink({ madeOn }: { madeOn: string | null }) {
  const [r, setR] = useState<Result>(null);
  const [pending, start] = useTransition();
  const link = r && r.ok ? r.link : undefined;
  return (
    <div className="space-y-3" data-testid="calendar-card">
      {madeOn && !link ? (
        <p className="text-sm">
          Your calendar link was made on <strong>{madeOn}</strong> and is working.
        </p>
      ) : null}
      {link ? (
        <div className="space-y-1">
          <input
            readOnly
            value={link}
            aria-label="Your calendar link"
            className="bg-background h-9 w-full rounded-md border px-2 font-mono text-xs"
            onFocus={(e) => e.currentTarget.select()}
            data-testid="calendar-link"
          />
          <p className="text-muted-foreground text-xs">
            Outlook: Add calendar → Subscribe from web. Google Calendar: Other calendars → From URL.
          </p>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={pending}
          onClick={() => start(async () => setR(await makeCalendarLinkAction()))}
          data-testid="calendar-make"
        >
          {madeOn || link ? 'Make a new link (the old one stops)' : 'Make my calendar link'}
        </Button>
        {madeOn || link ? (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => start(async () => setR(await stopCalendarLinkAction()))}
          >
            Stop the link
          </Button>
        ) : null}
      </div>
      <Feedback r={r} />
    </div>
  );
}

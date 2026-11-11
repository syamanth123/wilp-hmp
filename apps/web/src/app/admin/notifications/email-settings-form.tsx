'use client';

import { useState, useTransition } from 'react';
import { Button } from '@hmp/ui';
import { saveEmailSettingsAction } from './actions';

/** v1.4.3 (H28): where replies go, and the help contact in every email's footer. */
export function EmailSettingsForm({ replyTo, help }: { replyTo: string; help: string }) {
  const [state, setState] = useState<Awaited<ReturnType<typeof saveEmailSettingsAction>> | null>(
    null,
  );
  const [pending, start] = useTransition();
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => setState(await saveEmailSettingsAction(null, fd)));
  };
  const field = 'bg-background h-9 w-full max-w-md rounded-md border px-2 text-sm';
  return (
    <form onSubmit={onSubmit} className="space-y-4" data-testid="email-settings">
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Reply-to address</span>
        <input
          name="replyTo"
          type="email"
          defaultValue={replyTo}
          placeholder="e.g. the Instruction Cell mailbox"
          className={field}
          data-testid="settings-reply-to"
        />
        <span className="text-muted-foreground mt-1 block text-xs">
          Replies to HMP emails go here, and the footer says so. Empty: the footer says “Please do
          not reply”.
        </span>
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Help contact</span>
        <input
          name="help"
          defaultValue={help}
          placeholder="e.g. Instruction Cell, ic-mailbox@… , 01596-…"
          className={field}
          data-testid="settings-help"
        />
        <span className="text-muted-foreground mt-1 block text-xs">
          Shown as “Help: …” in every email’s footer. Empty: left out.
        </span>
      </label>
      <Button type="submit" size="sm" disabled={pending} data-testid="settings-save">
        Save
      </Button>
      {state ? (
        <p className={`text-sm ${state.ok ? 'text-emerald-800' : 'text-red-700'}`} role="status">
          {state.ok ? state.message : state.error}
        </p>
      ) : null}
    </form>
  );
}

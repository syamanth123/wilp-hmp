'use client';

import Link from 'next/link';
import { useRef, useState, useTransition } from 'react';
import { deleteLibraryView, saveLibraryView } from './actions';

/** "Save this view": names the current library address for this person (top right of the list). */
export function SaveViewButton({ query }: { query: string }) {
  const [name, setName] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const details = useRef<HTMLDetailsElement>(null);

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const r = await saveLibraryView(name, query);
      setMessage({ ok: r.ok, text: r.message });
      if (r.ok) {
        setName('');
        details.current?.removeAttribute('open');
      }
    });
  };

  return (
    <div className="relative inline-flex items-center gap-2">
      {message && (
        <span
          role="status"
          className={message.ok ? 'text-xs text-green-800' : 'text-xs text-red-700'}
          data-testid="save-view-message"
        >
          {message.text}
        </span>
      )}
      <details ref={details} className="relative" data-testid="save-view">
        <summary className="bg-background hover:bg-accent inline-flex cursor-pointer list-none items-center rounded-md border px-3 py-1.5 text-sm font-medium">
          Save this view
        </summary>
        <form
          onSubmit={save}
          className="bg-popover absolute right-0 z-20 mt-1 w-64 space-y-2 rounded-md border p-3 shadow-md"
        >
          <label htmlFor="save-view-name" className="block text-xs font-semibold">
            Name this view
          </label>
          <input
            id="save-view-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            placeholder="e.g. MBA overdue"
            className="border-input bg-background focus:ring-ring h-9 w-full rounded-md border px-2 text-sm focus:outline-none focus:ring-2"
            required
          />
          <button
            type="submit"
            disabled={pending || !name.trim()}
            className="w-full rounded-md bg-[var(--bits-navy)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {pending ? 'Saving…' : 'Save'}
          </button>
          <p className="text-muted-foreground text-xs">
            Saves the tab, quick view, filters and sort. Only you see your saved views.
          </p>
        </form>
      </details>
    </div>
  );
}

export function SavedViewChip({
  id,
  name,
  href,
  active,
}: {
  id: string;
  name: string;
  href: string;
  active: boolean;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <span
      className={
        active
          ? 'inline-flex items-center gap-1 rounded-full border border-[var(--bits-navy)] bg-[var(--bits-blue-tint)] py-0.5 pl-3 pr-1'
          : 'inline-flex items-center gap-1 rounded-full border py-0.5 pl-3 pr-1'
      }
      data-testid="saved-view"
    >
      <Link href={href} aria-current={active ? 'true' : undefined} className="hover:underline">
        {name}
      </Link>
      <button
        type="button"
        disabled={pending}
        onClick={() => startTransition(() => deleteLibraryView(id))}
        className="text-muted-foreground hover:bg-accent hover:text-foreground rounded-full px-1.5"
        aria-label={`Remove saved view ${name}`}
      >
        ✕
      </button>
    </span>
  );
}

'use client';

import { useState, useTransition } from 'react';
import { Button } from '@hmp/ui';
import { convertToStructuredAction } from '../structured-actions';

interface Props {
  requestId: string;
}

/**
 * Banner shown above the legacy TipTap editor when `data` is null. Faculty
 * either continues with the legacy editor (preserves their current content)
 * or clicks Convert. Conversion is one-way at the moment it commits: the
 * legacy path remains visually accessible right up until the structured
 * save lands. After that the page re-renders and only the structured
 * editor shows (because `data` is now non-null).
 */
export function ConvertBanner({ requestId }: Props) {
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const convert = () => {
    setErr(null);
    const fd = new FormData();
    fd.set('requestId', requestId);
    startTransition(async () => {
      const r = await convertToStructuredAction(fd);
      if (r?.error) setErr(r.error);
      // On success, server-side revalidatePath re-renders the page; the
      // page sees `data` populated and renders <StructuredEditor> instead
      // of this banner + the legacy editor.
    });
  };

  return (
    <div
      className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm"
      data-testid="bits-convert-banner"
    >
      <p className="font-medium">This handout uses the old editor.</p>
      <p className="text-muted-foreground mt-1">
        Keep editing below, or switch to the new page-style editor. Switching fills in the course
        details from the request (title, numbers, you as instructor); the other sections start
        blank, so keep this page open in another tab and copy over what you&apos;ve written.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={convert}
          disabled={pending}
          data-testid="bits-convert-button"
        >
          {pending ? 'Converting…' : 'Switch to the new editor'}
        </Button>
        {err && <span className="text-destructive text-xs">{err}</span>}
      </div>
    </div>
  );
}

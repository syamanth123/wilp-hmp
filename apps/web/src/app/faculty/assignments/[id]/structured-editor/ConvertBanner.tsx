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
      <p className="font-medium">This handout was created in the legacy editor.</p>
      <p className="text-muted-foreground mt-1">
        Continue editing below in the legacy editor, or convert to the structured editor. Conversion
        pre-populates Part A from the request (course title, numbers, you as the instructor); other
        sections start blank — keep this tab open in another window and copy over what you've
        written.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={convert}
          disabled={pending}
          data-testid="bits-convert-button"
        >
          {pending ? 'Converting…' : 'Convert to structured editor'}
        </Button>
        {err && <span className="text-destructive text-xs">{err}</span>}
      </div>
    </div>
  );
}

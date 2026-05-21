'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@hmp/ui';
import { publishAction, confirmManualPublishAction } from './actions';

export function PublishPanel({
  requestId,
  taxilaConfigured,
  exportDownloadUrl,
}: {
  requestId: string;
  taxilaConfigured: boolean;
  /** Present when a Mode B export exists and the request awaits manual
   *  confirmation. Freshly presigned by the server on each render. */
  exportDownloadUrl: string | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [showInstructions, setShowInstructions] = useState(false);
  const router = useRouter();

  const run = (fn: (fd: FormData) => Promise<{ ok?: boolean; error?: string }>) => {
    setError(null);
    const fd = new FormData();
    fd.set('requestId', requestId);
    startTransition(async () => {
      const r = await fn(fd);
      if (r?.error) {
        setError(r.error);
      } else {
        // Re-fetch the server component so the panel reflects the new state:
        // Mode A → PUBLISHED (Archive card), Mode B → awaiting-confirmation.
        router.refresh();
      }
    });
  };

  // State B — an export package exists; the IC must finish the manual upload.
  if (exportDownloadUrl) {
    return (
      <div
        role="alert"
        style={{
          background: '#fff7ed',
          border: '1px solid #fdba74',
          borderLeft: '4px solid #ea580c',
          borderRadius: 8,
          padding: '14px 16px',
        }}
        className="space-y-3"
      >
        <div style={{ fontWeight: 700, fontSize: 15, color: '#9a3412' }}>
          Action required: finish publishing
        </div>
        <p className="text-sm" style={{ color: '#7c2d12', margin: 0 }}>
          The Taxila API isn&apos;t configured, so this handout was exported as a downloadable
          package. Upload it to Taxila manually, then mark it as published below.
        </p>

        <ol className="text-sm" style={{ color: '#7c2d12', margin: 0, paddingLeft: 18 }}>
          <li>
            <a
              href={exportDownloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline underline-offset-2"
            >
              Download the export package (.zip)
            </a>
          </li>
          <li>Upload its contents to Taxila for this course.</li>
          <li>Return here and confirm.</li>
        </ol>

        <button
          type="button"
          onClick={() => setShowInstructions((s) => !s)}
          className="text-xs underline underline-offset-2"
          style={{ color: '#9a3412' }}
        >
          {showInstructions ? 'Hide' : 'Show'} detailed upload instructions
        </button>
        {showInstructions && (
          <pre
            className="whitespace-pre-wrap text-xs"
            style={{
              background: 'rgba(255,255,255,0.6)',
              border: '1px solid #fed7aa',
              borderRadius: 6,
              padding: 10,
              color: '#7c2d12',
              margin: 0,
            }}
          >
            {`1. Log in to Taxila and open the target course.
2. Create/replace the course handout using handout.html from the package.
3. Confirm it renders correctly in Taxila.
4. Click "Mark as manually published" below.`}
          </pre>
        )}

        {error && <p className="text-destructive text-sm">{error}</p>}

        <div>
          <Button onClick={() => run(confirmManualPublishAction)} disabled={pending}>
            {pending ? 'Confirming…' : 'Mark as manually published'}
          </Button>
        </div>
      </div>
    );
  }

  // State A — no export yet; offer the publish action.
  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">
        {taxilaConfigured
          ? 'Publishes the approved handout to Taxila via the LMS API and moves the request to PUBLISHED.'
          : 'Taxila API is not configured — publishing will generate a downloadable export package for manual upload.'}
      </p>
      <p className="text-muted-foreground text-xs">
        {taxilaConfigured
          ? 'Publishing via Taxila API'
          : 'Publishing via export (Taxila API not configured)'}
      </p>
      {error && <p className="text-destructive text-sm">{error}</p>}
      <Button onClick={() => run(publishAction)} disabled={pending}>
        {pending ? 'Publishing…' : 'Publish to LMS'}
      </Button>
    </div>
  );
}

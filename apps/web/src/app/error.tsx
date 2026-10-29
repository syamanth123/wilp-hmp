'use client';

import Link from 'next/link';

/**
 * Friendly page for an unexpected error (including a page refusing a user
 * whose role can't see it). Says what happened and what to do next; never
 * shows the technical error. The digest lets IT find the server log line.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-10">
      <div className="glass-panel max-w-md p-10 text-center" data-testid="error-page">
        <h1 className="mb-2 text-2xl font-semibold" style={{ fontFamily: 'var(--font-serif)' }}>
          Something went wrong
        </h1>
        <p style={{ color: 'var(--muted)' }}>
          This page couldn&apos;t be shown. It may not be available for your account, or the server
          had a problem. Try again, or go back to your home page.
        </p>
        <div className="mt-5 flex justify-center gap-3">
          <button type="button" className="bits-btn bits-btn-primary" onClick={() => reset()}>
            Try again
          </button>
          <Link href="/" className="bits-btn">
            Go to your home page
          </Link>
        </div>
        {error.digest ? (
          <p className="mt-4 text-xs" style={{ color: 'var(--muted)' }}>
            If this keeps happening, tell IT this code: {error.digest}
          </p>
        ) : null}
      </div>
    </div>
  );
}

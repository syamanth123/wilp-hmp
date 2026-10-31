import Link from 'next/link';

/** Friendly 404: a mistyped address or something that no longer exists. */
export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-10">
      <div className="glass-panel max-w-md p-10 text-center" data-testid="not-found-page">
        <h1 className="mb-2 text-2xl font-semibold" style={{ fontFamily: 'var(--font-serif)' }}>
          Page not found
        </h1>
        <p style={{ color: 'var(--muted)' }}>
          The address may be mistyped, or the item may have been removed. Check the link, or go back
          to your home page.
        </p>
        <p className="mt-5">
          <Link href="/" className="bits-btn bits-btn-primary">
            Go to your home page
          </Link>
        </p>
      </div>
    </div>
  );
}

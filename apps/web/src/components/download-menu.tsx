/**
 * Export download menu (Prompt 23-b). A native `<details>` dropdown (no client
 * JS) linking to the binary export route for Word + PDF. Rendered by a page
 * only when the server has already decided the user may export (canExportHandout
 * — the 1F matrix); the route re-checks regardless (defence in depth).
 */
export function DownloadMenu({ requestId }: { requestId: string }) {
  const base = `/api/handouts/${requestId}/export`;
  return (
    <details className="group relative inline-block" data-testid="download-menu">
      <summary className="bg-background hover:bg-accent inline-flex cursor-pointer list-none items-center gap-1 rounded-md border px-3 py-1.5 text-sm font-medium">
        Download
        <span aria-hidden className="text-muted-foreground text-xs">
          ▾
        </span>
      </summary>
      <div className="bg-popover absolute right-0 z-10 mt-1 w-40 overflow-hidden rounded-md border shadow-md">
        <a
          href={`${base}/docx`}
          download
          data-testid="download-docx"
          className="hover:bg-accent block px-3 py-2 text-sm"
        >
          Word (.docx)
        </a>
        <a
          href={`${base}/pdf`}
          download
          data-testid="download-pdf"
          className="hover:bg-accent block border-t px-3 py-2 text-sm"
        >
          PDF
        </a>
      </div>
    </details>
  );
}

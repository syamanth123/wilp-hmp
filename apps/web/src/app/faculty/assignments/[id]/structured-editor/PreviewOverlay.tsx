'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { renderBitsHandout, type BitsHandoutV1 } from '@hmp/db';
import { Button } from '@hmp/ui';
import { HANDOUT_HOST_CSS } from './document/handout-host-css';

interface Props {
  requestId: string;
  data: BitsHandoutV1;
  isDirty: boolean;
  onClose: () => void;
}

/**
 * Full-screen read-only Preview (handout-editor-ux D6), drawn by the unchanged
 * `renderBitsHandout()` — the same function every export and read path uses, so
 * this is exactly what gets published. Download PDF uses the existing export
 * route, which prints the last SAVED version; with unsaved edits the button
 * asks for a save first rather than silently printing older content.
 */
export function PreviewOverlay({ requestId, data, isDirty, onClose }: Props) {
  const html = useMemo(
    () => renderBitsHandout(data, { cssScope: 'inline', logoSrc: '/bits-header.png' }),
    [data],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  // Rendered into <body>: the editor sits inside "glass" panels whose
  // backdrop-filter makes `position: fixed` relative to the panel, not the
  // window, so an in-place overlay would be trapped in the editor column.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col bg-slate-100"
      role="dialog"
      aria-modal="true"
      aria-label="Handout preview"
      data-testid="bits-preview"
    >
      <div className="flex flex-wrap items-center gap-2 border-b bg-white px-4 py-2 shadow-sm">
        <Button variant="outline" onClick={onClose} data-testid="bits-preview-back">
          ← Back to editing
        </Button>
        <span className="text-muted-foreground mr-auto text-sm">
          Preview — exactly what gets published
        </span>
        {isDirty ? (
          <Button variant="outline" disabled title="Save your changes first, then download.">
            Save first to download PDF
          </Button>
        ) : (
          <a
            href={`/api/handouts/${requestId}/export/pdf`}
            download
            className="bg-background hover:bg-accent inline-flex items-center rounded-md border px-3 py-2 text-sm font-medium"
            data-testid="bits-preview-pdf"
          >
            Download PDF
          </a>
        )}
      </div>
      <div className="flex-1 overflow-auto py-6">
        <div className="mx-auto max-w-[960px] rounded-lg bg-white p-6 shadow">
          <style>{HANDOUT_HOST_CSS}</style>
          <div dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </div>
    </div>,
    document.body,
  );
}

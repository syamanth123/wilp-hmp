'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@hmp/ui';

interface Props {
  isDirty: boolean;
  pending: boolean;
  savedAtLabel: string | null;
  isRework: boolean;
  /** Plain-words reason Save is blocked, or null. */
  saveBlockedReason: string | null;
  /** Plain-words reason Submit is blocked, or null. */
  submitBlockedReason: string | null;
  notes: string;
  onNotesChange: (s: string) => void;
  onSave: () => void;
  onPreview: () => void;
  onSubmit: () => void;
  /** Present only when AI features are switched on. */
  onOpenAiDraft?: () => void;
}

/**
 * Sticky editor toolbar (handout-editor-ux D5): Save draft · Preview · Submit
 * for review, an unsaved-changes dot, the last-saved time, and a More menu with
 * the less common actions (AI draft, version note). Blocked buttons explain
 * themselves on hover and in a line under the bar.
 */
export function EditorToolbar({
  isDirty,
  pending,
  savedAtLabel,
  isRework,
  saveBlockedReason,
  submitBlockedReason,
  notes,
  onNotesChange,
  onSave,
  onPreview,
  onSubmit,
  onOpenAiDraft,
}: Props) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!moreOpen) return;
    const close = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [moreOpen]);

  return (
    <div
      className="sticky top-[72px] z-20 -mx-1 rounded-lg border bg-white px-3 py-2 shadow-sm"
      data-testid="bits-editor-toolbar"
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto flex items-center gap-2 text-sm" aria-live="polite">
          {isDirty ? (
            <>
              <span
                className="inline-block h-2 w-2 rounded-full bg-amber-500"
                aria-hidden
                data-testid="bits-unsaved-dot"
              />
              <span className="text-amber-700">Unsaved changes</span>
            </>
          ) : savedAtLabel ? (
            <span className="text-emerald-700" data-testid="bits-editor-saved">
              ✓ {savedAtLabel}
            </span>
          ) : (
            <span className="text-muted-foreground">All changes saved</span>
          )}
        </div>
        <Button
          variant="outline"
          onClick={onSave}
          disabled={pending || saveBlockedReason !== null}
          title={saveBlockedReason ?? undefined}
          data-testid="bits-save-button"
        >
          {pending ? 'Saving…' : 'Save draft'}
        </Button>
        <Button variant="outline" onClick={onPreview} data-testid="bits-preview-button">
          Preview
        </Button>
        <Button
          onClick={onSubmit}
          disabled={pending || submitBlockedReason !== null}
          title={submitBlockedReason ?? undefined}
          data-testid="bits-submit-button"
        >
          {isRework ? 'Resubmit for review' : 'Submit for review'}
        </Button>
        <div className="relative" ref={moreRef}>
          <Button
            variant="ghost"
            onClick={() => setMoreOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            data-testid="bits-more-button"
          >
            More ▾
          </Button>
          {moreOpen && (
            <div
              role="menu"
              className="absolute right-0 z-30 mt-1 w-72 rounded-md border bg-white p-2 shadow-lg"
            >
              {onOpenAiDraft && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMoreOpen(false);
                    onOpenAiDraft();
                  }}
                  className="mb-1 w-full rounded border-b px-2 py-1.5 text-left text-sm hover:bg-slate-50"
                  data-testid="bits-ai-open"
                >
                  AI draft — start from the course title
                </button>
              )}
              <div className="px-2 pt-1">
                <label htmlFor="bits-version-notes" className="text-muted-foreground text-xs">
                  Note for this version (optional)
                </label>
                <textarea
                  id="bits-version-notes"
                  value={notes}
                  onChange={(e) => onNotesChange(e.target.value)}
                  placeholder="What changed?"
                  rows={2}
                  className="mt-1 w-full rounded-md border p-1.5 text-sm"
                />
              </div>
            </div>
          )}
        </div>
      </div>
      {(saveBlockedReason || submitBlockedReason) && (
        <p className="text-muted-foreground mt-1 text-xs" data-testid="bits-blocked-reason">
          {saveBlockedReason ?? submitBlockedReason}
        </p>
      )}
    </div>
  );
}

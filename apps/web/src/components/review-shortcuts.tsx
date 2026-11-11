'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * v1.4.2 (F15) — keyboard shortcuts on the review pages (HOG final approval, PC review, SME review):
 *   A  moves to the Approve button — Enter then approves (never in one key)
 *   R  jumps to the comment box, to send it back with a comment
 *   N  opens the next item waiting in the same list
 *   ?  shows this list
 * Never while typing in a box, and never with Ctrl / Alt / ⌘.
 */
export function ReviewShortcuts({ nextHref }: { nextHref: string | null }) {
  const router = useRouter();
  const [help, setHelp] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    const typing = (el: EventTarget | null) => {
      const t = el as HTMLElement | null;
      if (!t) return false;
      const tag = t.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === 'a') {
        const b = document.querySelector<HTMLButtonElement>(
          '[data-shortcut="approve"]:not([disabled])',
        );
        if (!b) return;
        e.preventDefault();
        b.scrollIntoView({ block: 'center' });
        b.focus();
        setHint('Approve is selected — press Enter to approve, Esc to cancel.');
      } else if (k === 'r') {
        const c = document.querySelector<HTMLTextAreaElement>('[data-shortcut="comment"]');
        if (!c) return;
        e.preventDefault();
        c.scrollIntoView({ block: 'center' });
        c.focus();
        setHint('Write what needs to change, then press the send-back button.');
      } else if (k === 'n' && nextHref) {
        e.preventDefault();
        router.push(nextHref);
      } else if (e.key === '?') {
        e.preventDefault();
        setHelp((h) => !h);
      } else if (e.key === 'Escape') {
        setHelp(false);
        setHint(null);
        (document.activeElement as HTMLElement | null)?.blur();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nextHref, router]);

  return (
    <>
      {hint ? (
        <p
          className="fixed bottom-4 right-4 z-50 rounded-md bg-slate-900 px-3 py-2 text-sm text-white shadow-lg"
          role="status"
        >
          {hint}
        </p>
      ) : null}
      {help ? (
        <div
          className="fixed bottom-4 right-4 z-50 w-72 rounded-md border bg-white p-3 text-sm shadow-lg"
          role="dialog"
          aria-label="Keyboard shortcuts"
          data-testid="shortcuts-help"
        >
          <div className="mb-2 font-semibold">Keyboard shortcuts</div>
          <ul className="space-y-1">
            <li>
              <kbd className="rounded border px-1">A</kbd> go to Approve (then Enter)
            </li>
            <li>
              <kbd className="rounded border px-1">R</kbd> write a comment to send it back
            </li>
            <li>
              <kbd className="rounded border px-1">N</kbd> next item{' '}
              {nextHref ? '' : '(none waiting)'}
            </li>
            <li>
              <kbd className="rounded border px-1">?</kbd> show / hide this list ·{' '}
              <kbd className="rounded border px-1">Esc</kbd> close
            </li>
          </ul>
        </div>
      ) : (
        <p className="text-muted-foreground text-xs" data-testid="shortcuts-tip">
          Tip: press <kbd className="rounded border px-1">?</kbd> for keyboard shortcuts.
        </p>
      )}
    </>
  );
}

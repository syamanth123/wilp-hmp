'use client';

import { useState, useRef, useId, type KeyboardEvent } from 'react';
import { Button, Label } from '@hmp/ui';

interface Props {
  /** Current chip values. */
  value: string[];
  /** Called with the next array on add/remove/edit. */
  onChange: (next: string[]) => void;
  /** Field label rendered above the chip strip. */
  label: string;
  /** Placeholder for the input. */
  placeholder?: string;
  /**
   * Optional typeahead/suggestion list. When provided, the input shows
   * matching suggestions in a dropdown; selecting one fills the input
   * (faculty can then append free-form text and press Enter).
   *
   * The references chip-list passes the textBook + referenceBook codes
   * from Part A so faculty sees valid T/R codes as they type.
   */
  suggestions?: string[];
  /**
   * Predicate that returns true if the chip is "warningly valid" — e.g.
   * a references entry that doesn't reference a known T/R code. The chip
   * still renders (schema allows any string) but with an amber border.
   */
  warnIf?: (chip: string) => boolean;
  /** data-testid prefix for E2E selectors (e.g. "bits-subtopics-1"). */
  testIdPrefix?: string;
}

/**
 * Shared horizontal pill-style chip input. Used for short string lists
 * (sub-topics, references). For paragraph-length items see `BulletList`.
 *
 * Faculty workflow:
 *   - Type a chip value in the input.
 *   - Press Enter (or comma) to add. Empty input → no-op.
 *   - Click ✕ on a chip to remove.
 *   - When `suggestions` is provided, matching suggestions appear in a
 *     dropdown; click to fill the input (then Enter to commit or edit).
 *
 * The component is fully controlled: no internal value state for the chips
 * themselves; only the in-progress draft input is local.
 */
export function ChipList({
  value,
  onChange,
  label,
  placeholder,
  suggestions,
  warnIf,
  testIdPrefix,
}: Props) {
  const [draft, setDraft] = useState('');
  const [showSuggest, setShowSuggest] = useState(false);
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    // Allow comma-separated bulk paste: split on commas while preserving
    // empties as a no-op.
    const parts = trimmed
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    onChange([...value, ...parts]);
    setDraft('');
    setShowSuggest(false);
  };

  const remove = (idx: number) => onChange(value.filter((_, i) => i !== idx));

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit(draft);
    } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
      // Quick way to remove the last chip on empty input.
      onChange(value.slice(0, -1));
    }
  };

  const matches =
    suggestions && draft.trim()
      ? suggestions.filter((s) => s.toLowerCase().includes(draft.toLowerCase())).slice(0, 8)
      : [];

  return (
    <div className="grid gap-1" data-testid={testIdPrefix ?? undefined}>
      <Label htmlFor={inputId} className="text-xs">
        {label}
      </Label>
      <div className="flex flex-wrap gap-1">
        {value.map((chip, idx) => {
          const warn = warnIf?.(chip);
          return (
            <span
              key={`${chip}-${idx}`}
              data-testid={testIdPrefix ? `${testIdPrefix}-chip-${idx}` : undefined}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
                warn ? 'border-amber-400 bg-amber-50' : 'border-slate-300 bg-slate-100'
              }`}
              title={warn ? 'No matching code in Part A — saves anyway' : undefined}
            >
              <span className="font-mono">{chip}</span>
              <button
                type="button"
                onClick={() => remove(idx)}
                aria-label={`Remove ${chip}`}
                className="text-slate-500 hover:text-slate-900"
              >
                ×
              </button>
            </span>
          );
        })}
      </div>
      <div className="relative">
        <input
          id={inputId}
          ref={inputRef}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setShowSuggest(true);
          }}
          onKeyDown={onKey}
          onFocus={() => setShowSuggest(true)}
          onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
          placeholder={placeholder ?? 'Type then press Enter'}
          className="bg-background w-full rounded-md border px-2 py-1 text-sm"
          data-testid={testIdPrefix ? `${testIdPrefix}-input` : undefined}
        />
        {showSuggest && matches.length > 0 && (
          <ul
            className="absolute z-10 mt-1 max-h-44 w-full overflow-auto rounded-md border bg-white text-sm shadow-lg"
            role="listbox"
          >
            {matches.map((m) => (
              <li key={m}>
                <button
                  type="button"
                  className="w-full px-2 py-1 text-left font-mono hover:bg-slate-50"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setDraft(m);
                    inputRef.current?.focus();
                  }}
                >
                  {m}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {value.length === 0 && (
        <p className="text-muted-foreground text-xs italic">No entries yet.</p>
      )}
      {draft.trim() && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => commit(draft)}
          data-testid={testIdPrefix ? `${testIdPrefix}-add` : undefined}
          className="w-fit"
        >
          + Add &ldquo;{draft.trim().slice(0, 40)}
          {draft.trim().length > 40 ? '…' : ''}&rdquo;
        </Button>
      )}
    </div>
  );
}

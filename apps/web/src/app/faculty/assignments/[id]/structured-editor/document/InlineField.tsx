'use client';

import { useLayoutEffect, useRef } from 'react';

interface Props {
  value: string;
  onChange: (next: string) => void;
  /** Grey hint shown while empty, in the field's own words ("Click to add course title"). */
  placeholder: string;
  /** Accessible name; the visible label is the handout's own row header. */
  label: string;
  testId?: string;
  /** Single line (Enter does nothing) or wrapping multi-line text. */
  multiline?: boolean;
  /** Numeric-only entry (credit units, version no, hours). */
  numeric?: boolean;
  /** Inline width for short values sitting inside a sentence (e.g. hours). */
  widthCh?: number;
  /** Shown under the field in plain words when set (D4). */
  problem?: string | null;
  className?: string;
}

/**
 * One editable value on the handout page (handout-editor-ux D2). A textarea that
 * grows with its content and is styled to read as printed text: it inherits the
 * page's font, has no box until hovered (dashed outline) or focused (soft yellow
 * fill). Every value on the document page is one of these, so "click the text to
 * change it" is the only thing faculty need to learn.
 */
export function InlineField({
  value,
  onChange,
  placeholder,
  label,
  testId,
  multiline = false,
  numeric = false,
  widthCh,
  problem,
  className,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Auto-grow: height follows content, so a long title wraps like printed text.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <span className={['hed-field-wrap', widthCh ? 'hed-field-inline' : ''].join(' ').trim()}>
      <textarea
        ref={ref}
        rows={1}
        value={value}
        aria-label={label}
        aria-invalid={problem ? true : undefined}
        placeholder={placeholder}
        data-testid={testId}
        inputMode={numeric ? 'numeric' : undefined}
        spellCheck={!numeric}
        className={['hed-field', problem ? 'hed-field-problem' : '', className ?? '']
          .filter(Boolean)
          .join(' ')}
        style={widthCh ? { width: `${widthCh}ch` } : undefined}
        onChange={(e) => {
          let next = e.target.value;
          if (!multiline) next = next.replace(/[\r\n]+/g, ' ');
          if (numeric) next = next.replace(/[^0-9]/g, '');
          onChange(next);
        }}
        onKeyDown={(e) => {
          if (!multiline && e.key === 'Enter') e.preventDefault();
        }}
      />
      {problem && (
        <span className="hed-problem" role="alert">
          {problem}
        </span>
      )}
    </span>
  );
}

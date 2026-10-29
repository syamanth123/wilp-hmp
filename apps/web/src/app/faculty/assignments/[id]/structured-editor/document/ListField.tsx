'use client';

import { useEffect, useState } from 'react';
import { InlineField } from './InlineField';

interface Props {
  list: string[];
  onChange: (next: string[]) => void;
  /** How the list is shown while editing: one per line, or comma-separated. */
  mode: 'lines' | 'commas';
  placeholder: string;
  label: string;
  testId?: string;
  problem?: string | null;
}

const split = (s: string, mode: Props['mode']): string[] =>
  s
    .split(mode === 'lines' ? /\n/ : /[,/]/)
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * A list value edited as plain text (one item per line, or comma-separated).
 * Keeps the faculty member's own typing — a trailing comma or a fresh empty
 * line — while committing the parsed list on every keystroke, and only re-syncs
 * when the list is replaced from outside (AI draft, reset).
 */
export function ListField({ list, onChange, mode, placeholder, label, testId, problem }: Props) {
  const join = (l: string[]) => l.join(mode === 'lines' ? '\n' : ', ');
  const [text, setText] = useState(join(list));
  const key = list.join('\u0001');
  useEffect(() => {
    setText((current) => (split(current, mode).join('\u0001') !== key ? join(list) : current));
  }, [key, mode]);

  return (
    <InlineField
      value={text}
      onChange={(s) => {
        setText(s);
        onChange(split(s, mode));
      }}
      placeholder={placeholder}
      label={label}
      testId={testId}
      multiline={mode === 'lines'}
      problem={problem}
    />
  );
}

'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import { useEffect, useState } from 'react';
import { BITS_TIPTAP_EXTENSIONS } from '@/lib/bits-tiptap-extensions';

interface Props {
  /** Initial HTML string (sanitized by the renderer when persisted). */
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeightPx?: number;
  /**
   * 'boxed' (default): a bordered text box. 'page': blends into the handout
   * page — no box until hovered (dashed outline) or focused (soft yellow), with
   * a grey placeholder while empty (handout-editor-ux D2).
   */
  variant?: 'boxed' | 'page';
  testId?: string;
  label?: string;
}

/**
 * Compact TipTap wrapper for the rich-text fields of the structured editor
 * (course description, laboratory component, experiential objective,
 * evaluation guidelines, syllabi, notes).
 *
 * Uses `BITS_TIPTAP_EXTENSIONS` which is derived from the SAME shared
 * allowlist constants the renderer's sanitizer uses — so the editor can
 * only produce tags the renderer will keep (mechanical drift impossible).
 */
export function RichTextSubEditor({
  value,
  onChange,
  placeholder,
  minHeightPx = 100,
  variant = 'boxed',
  testId,
  label,
}: Props) {
  const [empty, setEmpty] = useState(true);
  const editor = useEditor({
    extensions: BITS_TIPTAP_EXTENSIONS,
    content: value || '<p></p>',
    // Suppresses TipTap's "SSR detected" console warning (client boundary anyway).
    immediatelyRender: false,
    editorProps: {
      attributes:
        variant === 'page'
          ? {
              class: 'hed-rte-page bits-handout-prose',
              style: `min-height:${minHeightPx}px`,
              ...(label ? { 'aria-label': label } : {}),
            }
          : {
              class:
                'prose prose-sm max-w-none rounded-md border bg-background p-3 focus:outline-none',
              style: `min-height:${minHeightPx}px`,
            },
    },
    onCreate: ({ editor }) => setEmpty(editor.getText().trim() === ''),
    onUpdate: ({ editor }) => {
      setEmpty(editor.getText().trim() === '');
      onChange(editor.getHTML());
    },
  });

  // Keep the editor in sync if the value is replaced externally (AI draft, reset).
  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value || '<p></p>', false);
      setEmpty(editor.getText().trim() === '');
    }
  }, [editor, value]);

  if (variant === 'page') {
    return (
      <div className="hed-rte" data-testid={testId}>
        {placeholder && empty && (
          <span className="hed-rte-placeholder" aria-hidden>
            {placeholder}
          </span>
        )}
        <EditorContent editor={editor} />
      </div>
    );
  }

  return (
    <div className="bits-rte" data-testid={testId}>
      {placeholder && !editor?.getText() && (
        <p className="text-muted-foreground -mb-1 text-xs italic">{placeholder}</p>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}

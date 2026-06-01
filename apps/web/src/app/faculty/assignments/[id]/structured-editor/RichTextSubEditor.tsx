'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import { useEffect } from 'react';
import { BITS_TIPTAP_EXTENSIONS } from '@/lib/bits-tiptap-extensions';

interface Props {
  /** Initial HTML string (sanitized by the renderer when persisted). */
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeightPx?: number;
}

/**
 * Compact TipTap wrapper for the four rich-text sub-fields of the
 * structured editor (courseDescription, laboratoryComponent,
 * experientialLearning.overallObjective, evaluationGuidelines).
 *
 * Uses `BITS_TIPTAP_EXTENSIONS` which is derived from the SAME shared
 * allowlist constants the renderer's sanitizer uses — so the editor can
 * only produce tags the renderer will keep (mechanical drift impossible).
 */
export function RichTextSubEditor({ value, onChange, placeholder, minHeightPx = 100 }: Props) {
  const editor = useEditor({
    extensions: BITS_TIPTAP_EXTENSIONS,
    content: value || '<p></p>',
    // Suppresses TipTap's "SSR detected" console warning. The editor is in a
    // 'use client' boundary anyway, so deferring the initial render to the
    // effect pass costs nothing and silences the noise.
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none rounded-md border bg-background p-3 focus:outline-none',
        style: `min-height:${minHeightPx}px`,
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  // Keep the editor in sync if the value is replaced externally (e.g. when
  // the parent state resets to initialData on Cancel).
  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value || '<p></p>', false);
    }
  }, [editor, value]);

  return (
    <div className="bits-rte">
      {placeholder && !editor?.getText() && (
        <p className="text-muted-foreground -mb-1 text-xs italic">{placeholder}</p>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}

import StarterKit from '@tiptap/starter-kit';
import type { AnyExtension } from '@tiptap/core';

// Single source of truth for the extension list — shared between the editor
// client component and the server-side HTML serializer so what the user sees
// matches what gets stored.
export const TIPTAP_EXTENSIONS: AnyExtension[] = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    codeBlock: false,
  }),
];

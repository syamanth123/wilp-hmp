import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import type { AnyExtension } from '@tiptap/core';
import { BITS_RICH_TEXT_ALLOWED_SCHEMES } from '@hmp/db';

/**
 * TipTap extension list for the structured editor's rich-text sub-fields
 * (Prompt 11d). Configured so the editor can ONLY produce tags the renderer's
 * sanitizer allowlist permits — drift between editor and renderer is
 * mechanically impossible because both derive from the SAME shared constants
 * in `@hmp/db` (`BITS_RICH_TEXT_*`).
 *
 * Compared with the legacy `TIPTAP_EXTENSIONS`:
 *   - heading / blockquote / codeBlock removed (renderer strips these)
 *   - Link added (renderer allows `<a href>` with restricted schemes)
 *   - Underline added (renderer allows `<u>`)
 *   - Everything else from StarterKit retained: paragraph, strong/em/code,
 *     bullet/ordered list, list item, hard break, history.
 *
 * The legacy `TIPTAP_EXTENSIONS` continues to power the legacy editor for
 * pre-Prompt-11d handouts; this list powers the new structured-editor's four
 * rich-text sub-fields (courseDescription, laboratoryComponent,
 * experientialLearning.overallObjective, evaluationGuidelines).
 */
export const BITS_TIPTAP_EXTENSIONS: AnyExtension[] = [
  StarterKit.configure({
    heading: false,
    blockquote: false,
    codeBlock: false,
  }),
  Link.configure({
    openOnClick: false,
    HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
    protocols: [...BITS_RICH_TEXT_ALLOWED_SCHEMES],
  }),
  Underline,
];

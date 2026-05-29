/**
 * Single source of truth for the tags / attributes / URI schemes allowed in
 * BITS handout rich-text fields.
 *
 * Used by:
 * - [handout-renderer.ts](./handout-renderer.ts) — `sanitize-html` config
 *   that strips disallowed tags from rendered output.
 * - apps/web's TipTap configuration for the structured editor's rich-text
 *   sub-fields (Prompt 11d) — the editor only allows tags this list permits.
 *
 * Defined as a single shared constant so the editor cannot produce content
 * the renderer would strip (or vice versa). Drift between the two is
 * mechanically impossible — change here, both ends update.
 */
export const BITS_RICH_TEXT_ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'u',
  'ul',
  'ol',
  'li',
  'a',
  'span',
  'code',
] as const;

export type BitsRichTextAllowedTag = (typeof BITS_RICH_TEXT_ALLOWED_TAGS)[number];

/**
 * Per-tag allowed attributes. Currently only `<a>` keeps `href`; the renderer
 * also restricts which URI schemes are valid via `BITS_RICH_TEXT_ALLOWED_SCHEMES`.
 */
export const BITS_RICH_TEXT_ALLOWED_ATTR: Readonly<Record<string, readonly string[]>> = {
  a: ['href'],
};

/**
 * Allowed URI schemes for any tag carrying a URL attribute (currently only
 * `<a href>`). Blocks `javascript:`, `data:`, `vbscript:`, etc.
 */
export const BITS_RICH_TEXT_ALLOWED_SCHEMES = ['http', 'https', 'mailto'] as const;

import { BitsHandoutSchemaV1 } from './handout-schema';
import { renderBitsHandout, type RenderOptions } from './handout-renderer';

/**
 * Single source of truth for the "structured `data` preferred; legacy
 * `contentHtml` as fallback" decision (Prompt 11c).
 *
 * Lives in `@hmp/db` so BOTH `apps/web` read paths AND `packages/integrations`
 * (the Mode B export ZIP builder) call the same helper. When the eventual
 * cleanup PR drops `contentHtml` after every row carries `data`, the rollover
 * is a one-file edit.
 *
 * Safe-parses the structured `data` against `BitsHandoutSchemaV1` before
 * rendering: if `data` is present but malformed (a future migration mishap,
 * say), this falls through to `contentHtml` so the consumer still shows
 * SOMETHING rather than crashing. Logging the malformed-data case is the
 * consumer's responsibility — the helper stays silent so it remains a pure,
 * importable function from anywhere.
 *
 * Default options match the standalone-document case (institutional header
 * included, inline CSS). In-app callers pass `{ logoSrc: '/bits-header.png' }`
 * so every role's Handout card shows the BITS letterhead (logo + institution
 * + division + document title) inline — the canonical look lives with the
 * content, not just the app chrome around it.
 */
export function resolveHandoutHtml(
  version: { data: unknown; contentHtml: string | null },
  options?: RenderOptions,
): string | null {
  if (version.data != null) {
    const parsed = BitsHandoutSchemaV1.safeParse(version.data);
    if (parsed.success) {
      return renderBitsHandout(parsed.data, options);
    }
    // Data present but invalid — fall through to legacy contentHtml.
  }
  return version.contentHtml ?? null;
}

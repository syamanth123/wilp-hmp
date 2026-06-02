/**
 * Sub-barrel for the corpus-import module (Prompt 11f-a). Server-only —
 * mammoth pulls in `node:fs/promises` which Next.js's client bundler
 * doesn't recognize. The top-level `@hmp/db` barrel deliberately does NOT
 * re-export these symbols; server consumers import via:
 *
 *   import { runCorpusImport, parseDocxFile } from '@hmp/db/src/corpus-import';
 *
 * If you see this barrel imported from a client component, the bundler will
 * error with `UnhandledSchemeError: Reading from "node:fs/promises"`. Move
 * the import to a server action / server component.
 */

export {
  parseDocxToHandout,
  parseDocxFile,
  type CorpusExtractionMethod,
  type ParseInput,
  type ParseResult,
} from './parser';

export { runCorpusImport, type ImportSummary, type ImportOptions } from './import-action';

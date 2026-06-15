import { PrismaClient } from '@prisma/client';

declare global {
  var __hmpPrisma: PrismaClient | undefined;
}

export const prisma =
  global.__hmpPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  global.__hmpPrisma = prisma;
}

export * from '@prisma/client';
export * from './notification-templates';
export {
  BitsHandoutSchemaV1,
  BitsHandoutSchema,
  LATEST_SCHEMA_VERSION,
  type BitsHandoutV1,
  type BitsHandout,
} from './handout-schema';
export { normalizeBitsCourseNumber, bitsCourseNumberSchema, getDiscipline } from './course-code';
export { renderBitsHandout, type RenderOptions } from './handout-renderer';
export { resolveHandoutHtml } from './handout-display';
export {
  BITS_RICH_TEXT_ALLOWED_TAGS,
  BITS_RICH_TEXT_ALLOWED_ATTR,
  BITS_RICH_TEXT_ALLOWED_SCHEMES,
  type BitsRichTextAllowedTag,
} from './rich-text-allowlist';
// NOTE: corpus-import (Prompt 11f-a) symbols are deliberately NOT re-exported
// from this top-level barrel. mammoth's Node-only `node:fs/promises` imports
// would leak into Next.js's client bundle via the @hmp/db root import path.
// Server-side consumers (admin actions) import directly from the subpath:
//   import { runCorpusImport } from '@hmp/db/dist/corpus-import';
// or, in source via the workspace, by relative path within node_modules:
//   import { runCorpusImport } from '@hmp/db/src/corpus-import';
// See `apps/web/src/app/admin/corpus-imports/actions.ts` for the concrete usage.
export { type CorpusExtractionMethod } from './corpus-import/parser';
export { ACTIVE_USER_FILTER, requireActiveUser } from './user-helpers';

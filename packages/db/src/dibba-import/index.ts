/**
 * Sub-barrel for the Course Dibba import module (Phase 2 parsers, Phase 3
 * persistence). Server-only — mammoth and exceljs pull in Node-only modules
 * that Next.js's client bundler doesn't recognize, and import-action.ts talks
 * to Prisma. The top-level `@hmp/db` barrel deliberately does NOT re-export
 * these symbols (same rule as corpus-import); server consumers import:
 *
 *   import { parseDibbaDocx, createDibbaImport } from '@hmp/db/src/dibba-import';
 *
 * The parsers (`parser.ts`, `xlsx.ts`, `xlsx-to-rows.ts`) are pure — bytes in →
 * rows + warnings out. `import-action.ts` owns the Prisma writes (create /
 * publish / discard an import, create a term) and the catalogue match; same
 * split as corpus-import. The .doc → .docx conversion lives in corpus-import's
 * `ensureDocxFormat` and is wired by the Phase 3 upload Route Handler, not here.
 * Warning-family markers are client-safe and live in `../dibba-warnings`
 * (exported from the top barrel) so the IC preview can classify without this module.
 */

export {
  parseDibbaDocx,
  parseDibbaHtml,
  htmlTablesToGrids,
  parseSlotHeader,
  parseBatchCell,
  programmeCodeOf,
  type ParseDibbaInput,
  type TableGrid,
} from './parser';

export {
  parseDibbaXlsx,
  parseDibbaXlsxDetailed,
  parseFacultySheet,
  facultyRowsFromRecords,
  type XlsxInput,
  type XlsxDibbaParse,
} from './xlsx';

export { xlsxRowToDibbaRow } from './xlsx-to-rows';

export {
  createDibbaImport,
  publishDibbaImport,
  discardDibbaImport,
  createAcademicTerm,
  matchCourseCodes,
  findCatalogueCourses,
  toDibbaCourseType,
  DibbaError,
  DIBBA_ENTRY_CHUNK,
  type DibbaErrorCode,
  type DibbaSourceFormat,
  type CatalogueCourse,
  type CreateDibbaImportArgs,
  type CreateDibbaImportResult,
  type PublishDibbaImportResult,
  type AcademicTermKind,
  type CreateAcademicTermArgs,
} from './import-action';

export type {
  DibbaRow,
  DibbaParseResult,
  DibbaCourseType,
  XlsxDibbaRow,
  FacultyRow,
} from './types';

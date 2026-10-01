/**
 * Sub-barrel for the Course Dibba import module (Phase 2). Server-only —
 * mammoth and exceljs pull in Node-only modules that Next.js's client bundler
 * doesn't recognize. The top-level `@hmp/db` barrel deliberately does NOT
 * re-export these symbols (same rule as corpus-import); server consumers import:
 *
 *   import { parseDibbaDocx, parseDibbaXlsx } from '@hmp/db/src/dibba-import';
 *
 * Everything here is a pure function (bytes in → rows + warnings out). The
 * .doc → .docx conversion lives in corpus-import's `ensureDocxFormat` and is
 * wired by the Phase 3 upload handler, not here.
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

export { parseDibbaXlsx, parseFacultySheet, facultyRowsFromRecords, type XlsxInput } from './xlsx';

export type {
  DibbaRow,
  DibbaParseResult,
  DibbaCourseType,
  XlsxDibbaRow,
  FacultyRow,
} from './types';

import type { SlotDay, SlotSession } from '../dibba-slots';

/**
 * Course Dibba parser output (Phase 2). Deliberately Prisma-free string
 * unions that mirror the Prisma enums one-to-one, so the parser stays a pure
 * function (bytes in → rows + warnings out) and is testable without a DB. The
 * Phase 3 server action maps these onto DibbaEntry rows.
 */
export type DibbaCourseType =
  | 'CORE'
  | 'ELECTIVE'
  | 'PROJECT'
  | 'BACKLOG'
  | 'NOT_OFFERED'
  | 'UNSPECIFIED';

/** One course, in one slot, for one programme × admit-batch row of the Dibba. */
export interface DibbaRow {
  programmeCode: string;
  programmeTitle: string;
  admitBatch: string | null;
  isNewAdmission: boolean;
  isBacklogRow: boolean;
  studentCount: number | null;
  slotNo: number;
  slotDay: SlotDay | null;
  slotSession: SlotSession | null;
  courseCode: string;
  courseTitle: string;
  courseType: DibbaCourseType;
  erpCourseId: string | null;
  classTimeHint: string | null;
  remarks: string | null;
  /** Whitespace-collapsed source fragment (≤120 chars) — "why did it parse like this". */
  rawCell: string;
}

export interface DibbaParseResult {
  rows: DibbaRow[];
  /** Header/structure anomalies for IC to confirm — never silently "fixed". */
  warnings: string[];
  /** Top-level tables seen (the 2025 doc has 51). */
  tableCount: number;
}

/** One row of the Excel Dibba sheet (`Course Dibba S1-…`), one per programme × batch × course. */
export interface XlsxDibbaRow {
  acadPlan: string;
  degree: string;
  programme: string;
  admitBatch: string;
  degreeSemester: string;
  /** Raw cell text: a number, "New ADM", "Backlog", "No Active Batch" … — callers decide. */
  studentCountRaw: string;
  domain: string;
  courseTypeRaw: string;
  slotNo: number | null;
  erpCourseId: string | null;
  courseCode: string;
  courseTitle: string;
  minUnits: string;
  remarks: string;
}

/**
 * One course → faculty mapping (Excel `Sheet3` shape, or a CSV with the same
 * headers). The source sheet also carries a Mobile column: it is NEVER read.
 */
export interface FacultyRow {
  courseCode: string;
  slotNo: number | null;
  facultyName: string;
  isLead: boolean;
  /** Lower-cased, trimmed; null when blank. */
  email: string | null;
  psrnOrGfid: string | null;
  department: string | null;
  campus: string | null;
}

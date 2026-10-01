import { STANDARD_SLOTS } from '../dibba-slots';
import type { DibbaCourseType, DibbaRow, XlsxDibbaRow } from './types';

/**
 * Excel Dibba row → the DibbaRow shape the Word parser produces (Phase 3), so
 * both formats feed `createDibbaImport` identically. Pure. The rules mirror
 * the Word path (parser.ts `classify`, `parseBatchCell`) and spec §5.6/§2:
 *
 *   - admit batch "1|2024" (already "1/2024" from the reader) → "1/2024";
 *     "Backlog" → null + isBacklogRow
 *   - "New ADM" in the student-count cell → isNewAdmission, count null
 *   - Exam Slot null (unreadable — the reader warned) → slot 0, no day/session
 *   - Type is classified from the Type TEXT only, exactly like the Word parser
 *     classifies the course cell: NOT OFFERED → NOT_OFFERED · BACKLOG/BKLG →
 *     BACKLOG · trailing-T code → PROJECT · CORE → CORE · EL / ELECTIVE →
 *     ELECTIVE · else UNSPECIFIED. A backlog admit batch does NOT override it —
 *     that fact is carried by `isBacklogRow`, as on the Word side (the 2025
 *     file's 25 backlog rows are 22 CORE / 3 PROJECT by type).
 *   - rawCell = "CODE|TITLE" (the Word cells' own shape) for the audit trail
 */

const BATCH_RE = /([12])\s*\/\s*(20\d\d)/;

function classifyXlsx(typeRaw: string, code: string): DibbaCourseType {
  const u = typeRaw.toUpperCase();
  if (u.includes('NOT OFFERED')) return 'NOT_OFFERED';
  if (u.includes('BACKLOG') || u.includes('BKLG')) return 'BACKLOG';
  if (code.endsWith('T')) return 'PROJECT';
  if (u.includes('CORE')) return 'CORE';
  if (u === 'EL' || u.includes('ELECTIVE')) return 'ELECTIVE';
  return 'UNSPECIFIED';
}

export function xlsxRowToDibbaRow(x: XlsxDibbaRow): DibbaRow {
  const batch = BATCH_RE.exec(x.admitBatch);
  const isBacklogRow = /backlog/i.test(`${x.admitBatch} ${x.degreeSemester} ${x.studentCountRaw}`);
  const slotNo = x.slotNo ?? 0;
  const std = STANDARD_SLOTS.find((s) => s.slotNo === slotNo);
  return {
    programmeCode: x.acadPlan.replace(/\s+/g, '').toUpperCase(),
    programmeTitle: `${x.degree} ${x.programme}`.replace(/\s+/g, ' ').trim(),
    admitBatch: batch ? `${batch[1]}/${batch[2]}` : null,
    isNewAdmission: /new\s*adm/i.test(x.studentCountRaw),
    isBacklogRow,
    studentCount: /^\d+$/.test(x.studentCountRaw) ? parseInt(x.studentCountRaw, 10) : null,
    slotNo,
    slotDay: std?.day ?? null,
    slotSession: std?.session ?? null,
    courseCode: x.courseCode,
    courseTitle: x.courseTitle,
    courseType: classifyXlsx(x.courseTypeRaw, x.courseCode),
    erpCourseId: x.erpCourseId,
    classTimeHint: null,
    remarks: x.remarks || null,
    rawCell: `${x.courseCode}|${x.courseTitle}`.slice(0, 120),
  };
}

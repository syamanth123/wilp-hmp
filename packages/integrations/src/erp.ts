import { z } from 'zod';
import { parseCsv } from './csv';

export const courseRowSchema = z.object({
  code: z.string().min(2).max(20),
  title: z.string().min(2),
  credits: z.coerce.number().int().min(1).max(20).default(3),
  description: z.string().optional().default(''),
});
export type CourseRow = z.infer<typeof courseRowSchema>;

export const programmeSemesterRowSchema = z.object({
  programme_code: z.string().min(2).max(30),
  programme_name: z.string().min(2),
  semester_name: z.string().min(2),
  year: z.coerce.number().int().min(2000).max(2100),
  term: z.enum(['FIRST', 'SECOND', 'SUMMER']),
  start_date: z.string().min(8),
  end_date: z.string().min(8),
  exam_date: z.string().optional().default(''),
  ec1_deadline: z.string().optional().default(''),
});
export type ProgrammeSemesterRow = z.infer<typeof programmeSemesterRowSchema>;

export const offeringRowSchema = z.object({
  programme_code: z.string().min(2),
  semester_name: z.string().min(2),
  course_code: z.string().min(2),
  slot_info: z.string().optional().default(''),
});
export type OfferingRow = z.infer<typeof offeringRowSchema>;

// Prompt 13 — IC bulk handout-request creation. Minimal columns (option a):
// programme + course + semester only; faculty/SME allocation is HOG's job
// (Prompt 14), not in this CSV. Column name `semester` (not `semester_name`)
// per the approved 12-b/13 spec — the existing CSV schemas aren't internally
// consistent on this anyway (courses use `code`, offerings use `course_code`).
export const handoutRequestRowSchema = z.object({
  programme_code: z.string().min(1, 'programme_code is required'),
  course_code: z.string().min(1, 'course_code is required'),
  semester: z.string().min(1, 'semester is required'),
});
export type HandoutRequestRow = z.infer<typeof handoutRequestRowSchema>;

// Prompt 14 — HOG bulk faculty + SME allocation. Addresses EXISTING requests
// by refNo. `faculty_emails` is a single email or a comma-separated list in a
// quoted cell (parseCsv unwraps the quotes; the caller splits on comma). No
// `is_off_campus` column — capping derives from each faculty's User.facultyType,
// not a per-allocation override (see audit §1).
export const allocationRowSchema = z.object({
  request_reference: z.string().min(1, 'request_reference is required'),
  faculty_emails: z.string().min(1, 'faculty_emails is required'),
  sme_email: z.string().min(1, 'sme_email is required'),
});
export type AllocationRow = z.infer<typeof allocationRowSchema>;

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM (00:00-23:59)');

export const slotBookingRowSchema = z.object({
  programme_code: z.string().min(2),
  semester_name: z.string().min(2),
  course_code: z.string().min(2),
  slot_type: z.enum(['class', 'exam']).default('class'),
  slot: z.string().min(1).max(40),
  day_of_week: z.coerce.number().int().min(0).max(6),
  start_time: timeOfDay,
  end_time: timeOfDay,
  room: z.string().optional().default(''),
});
export type SlotBookingRow = z.infer<typeof slotBookingRowSchema>;

export interface ParseResult<T> {
  ok: boolean;
  rows: T[];
  errors: Array<{ line: number; message: string }>;
}

function parseWith<S extends z.ZodTypeAny>(input: string, schema: S): ParseResult<z.output<S>> {
  const { rows } = parseCsv(input);
  const out: z.output<S>[] = [];
  const errors: Array<{ line: number; message: string }> = [];
  rows.forEach((row, idx) => {
    const r = schema.safeParse(row);
    if (r.success) {
      out.push(r.data);
    } else {
      errors.push({
        line: idx + 2, // +1 header, +1 0->1
        message: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      });
    }
  });
  return { ok: errors.length === 0, rows: out, errors };
}

export function parseCoursesCsv(input: string): ParseResult<CourseRow> {
  return parseWith(input, courseRowSchema);
}

export function parseProgrammesCsv(input: string): ParseResult<ProgrammeSemesterRow> {
  return parseWith(input, programmeSemesterRowSchema);
}

export function parseOfferingsCsv(input: string): ParseResult<OfferingRow> {
  return parseWith(input, offeringRowSchema);
}

const REQUIRED_HANDOUT_COLS = ['programme_code', 'course_code', 'semester'] as const;

/**
 * Prompt 13 — parse an IC bulk handout-request CSV into validated rows.
 *
 * Adds a header guard over bare `parseWith`: a missing required column reports
 * ONCE at line 1 ("missing required column(s): …") instead of repeating the
 * same Zod error on every data row. Row-level validation (non-empty fields)
 * then runs through `parseWith` exactly like the other parsers. Semantic
 * validation (programme/course/semester/offering existence, dedup) is the
 * caller's job — it needs DB access this package deliberately doesn't have.
 */
export function parseHandoutRequestsCsv(input: string): ParseResult<HandoutRequestRow> {
  const { header } = parseCsv(input);
  if (header.length > 0) {
    const missing = REQUIRED_HANDOUT_COLS.filter((c) => !header.includes(c));
    if (missing.length > 0) {
      return {
        ok: false,
        rows: [],
        errors: [{ line: 1, message: `missing required column(s): ${missing.join(', ')}` }],
      };
    }
  }
  return parseWith(input, handoutRequestRowSchema);
}

const REQUIRED_ALLOCATION_COLS = ['request_reference', 'faculty_emails', 'sme_email'] as const;

/**
 * Prompt 14 — parse a HOG bulk-allocation CSV into validated rows. Same header
 * guard + parseWith shape as parseHandoutRequestsCsv. `faculty_emails` is kept
 * as a raw string here (structural validation = non-empty); the comma-split +
 * per-email role checks are semantic, done by the caller against the DB.
 */
export function parseAllocationsCsv(input: string): ParseResult<AllocationRow> {
  const { header } = parseCsv(input);
  if (header.length > 0) {
    const missing = REQUIRED_ALLOCATION_COLS.filter((c) => !header.includes(c));
    if (missing.length > 0) {
      return {
        ok: false,
        rows: [],
        errors: [{ line: 1, message: `missing required column(s): ${missing.join(', ')}` }],
      };
    }
  }
  return parseWith(input, allocationRowSchema);
}

export function parseSlotBookingsCsv(input: string): ParseResult<SlotBookingRow> {
  return parseWith(input, slotBookingRowSchema);
}

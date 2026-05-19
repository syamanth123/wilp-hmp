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

const timeOfDay = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM (00:00-23:59)');

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

export function parseSlotBookingsCsv(input: string): ParseResult<SlotBookingRow> {
  return parseWith(input, slotBookingRowSchema);
}

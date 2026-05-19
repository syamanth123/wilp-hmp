// Integration adapters.
// erp.ts     — CSV import (M3) then real API (Phase 3)
// taxila.ts  — LMS publish stub (M6) then real API (Phase 3)
// email.ts   — SMTP via Nodemailer (M7)
export { parseCsv } from './csv';
export {
  parseCoursesCsv,
  parseProgrammesCsv,
  parseOfferingsCsv,
  parseSlotBookingsCsv,
  courseRowSchema,
  programmeSemesterRowSchema,
  offeringRowSchema,
  slotBookingRowSchema,
} from './erp';
export type {
  CourseRow,
  ProgrammeSemesterRow,
  OfferingRow,
  SlotBookingRow,
  ParseResult,
} from './erp';
export { publishToLms } from './taxila';
export type { PublishInput, PublishResult } from './taxila';
export { sendMail } from './email';
export type { SendMailInput, SendMailResult } from './email';

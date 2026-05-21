// Integration adapters.
// erp.ts     — CSV import (M3) then real API (Phase 3)
// taxila.ts  — LMS publish: Mode A (HTTP) / Mode B (export ZIP) — real
// storage.ts — S3-compatible object storage (MinIO dev / S3 prod)
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
export {
  publishToLms,
  buildTaxilaRequestBody,
  buildExportZip,
  TaxilaPublishError,
  // Legacy stub — still used by the IC publish action until Prompt 9b wires
  // the real engine. Removed in 9b.
  publishToLmsStub,
} from './taxila';
export type {
  PublishInput,
  PublishResult,
  LmsPublishLogStatus,
  StubPublishInput,
  StubPublishResult,
} from './taxila';
export { getS3Client, ensureBucket, uploadAndPresign } from './storage';
export type { UploadAndPresignInput } from './storage';
export { sendMail } from './email';
export type { SendMailInput, SendMailResult } from './email';

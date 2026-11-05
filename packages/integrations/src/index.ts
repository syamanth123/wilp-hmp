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
  parseHandoutRequestsCsv,
  parseAllocationsCsv,
  parseQueueActionsCsv,
  courseRowSchema,
  programmeSemesterRowSchema,
  offeringRowSchema,
  slotBookingRowSchema,
  handoutRequestRowSchema,
  allocationRowSchema,
  queueActionRowSchema,
} from './erp';
export type {
  CourseRow,
  ProgrammeSemesterRow,
  OfferingRow,
  SlotBookingRow,
  HandoutRequestRow,
  AllocationRow,
  QueueActionRow,
  ParseResult,
} from './erp';
export { publishToLms, buildTaxilaRequestBody, buildExportZip, TaxilaPublishError } from './taxila';
export type { PublishInput, PublishResult, LmsPublishLogStatus } from './taxila';
// v1.3.0 "Mode C": publish into the course's Taxila folder (IT's QPM method).
export {
  TaxilaError,
  checkInTaxila,
  createTaxilaClient,
  defaultTaxilaSemesterCode,
  findHandoutFolder,
  matchTaxilaCourse,
  nextFreeFileName,
  publishFileToTaxila,
  redact,
  taxilaConfigFromEnv,
  taxilaCourseUrl,
  taxilaFileName,
} from './taxila-moodle';
export type {
  CheckResult,
  CourseMatch,
  TaxilaClient,
  TaxilaConfig,
  TaxilaCourse,
  TaxilaFolder,
  TaxilaStep,
} from './taxila-moodle';
export {
  getS3Client,
  ensureBucket,
  uploadAndPresign,
  getPresignedDownloadUrl,
  deleteObject,
  tagObject,
  getObjectTags,
} from './storage';
export type { UploadAndPresignInput } from './storage';
export { sendMail } from './email';
export type { SendMailInput, SendMailResult } from './email';

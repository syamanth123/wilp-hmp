import { csvTemplateResponse } from '@/lib/csv-template-response';

// CSV template for the HOG bulk-allocation upload (Prompt 14). Header +
// #-commented sample rows (the parser skips '#'-prefixed lines). Multiple
// faculty go in one quoted, comma-separated cell.
const TEMPLATE_CSV = `request_reference,faculty_emails,sme_email
# Lines starting with '#' are ignored. Delete these examples or leave them — they are skipped.
# HMP-2026-0042,faculty@hmp.local,sme@hmp.local
# HMP-2026-0043,"a@hmp.local,b@hmp.local",sme@hmp.local
`;

export function GET(req: Request): Promise<Response> {
  return csvTemplateResponse(req, TEMPLATE_CSV, 'allocation-bulk-template.csv');
}

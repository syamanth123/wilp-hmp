import { csvTemplateResponse } from '@/lib/csv-template-response';

// CSV template for the IC bulk handout-request upload (Prompt 13). Header +
// #-commented sample rows (the parser skips lines starting with '#', so the
// examples are illustrative and ignored on upload).
const TEMPLATE_CSV = `programme_code,course_code,semester
# Lines starting with '#' are ignored. Delete these examples or leave them — they are skipped.
# MTECH-SE,SE ZG501,Sem-I 2025-26
# MTECH-DS,CC ZG501,Sem-I 2025-26
`;

export function GET(req: Request): Promise<Response> {
  return csvTemplateResponse(req, TEMPLATE_CSV, 'handout-bulk-template.csv');
}

import { csvTemplateResponse } from '@/lib/csv-template-response';
import { IC_BULK_UPLOAD_TEMPLATE } from '@/lib/bulk-templates';

// CSV template for the IC bulk handout-request upload (Prompt 13). Header +
// #-commented sample rows (the parser skips lines starting with '#', so the
// examples are illustrative and ignored on upload).

export function GET(req: Request): Promise<Response> {
  return csvTemplateResponse(req, IC_BULK_UPLOAD_TEMPLATE, 'handout-bulk-template.csv');
}

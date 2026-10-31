import { csvTemplateResponse } from '@/lib/csv-template-response';
import { PC_BULK_REVIEW_TEMPLATE } from '@/lib/bulk-templates';

// CSV template for PC bulk review (Prompt 15). '#'-prefixed lines are skipped.

export function GET(req: Request): Promise<Response> {
  return csvTemplateResponse(req, PC_BULK_REVIEW_TEMPLATE, 'pc-bulk-review-template.csv');
}

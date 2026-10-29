import { csvTemplateResponse } from '@/lib/csv-template-response';
import { SME_BULK_REVIEW_TEMPLATE } from '@/lib/bulk-templates';

// CSV template for SME bulk review (Prompt 15). '#'-prefixed lines are skipped.

export function GET(req: Request): Promise<Response> {
  return csvTemplateResponse(req, SME_BULK_REVIEW_TEMPLATE, 'sme-bulk-review-template.csv');
}

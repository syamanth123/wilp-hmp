import { csvTemplateResponse } from '@/lib/csv-template-response';
import { HOG_BULK_REVIEW_TEMPLATE } from '@/lib/bulk-templates';

// CSV template for HOG bulk review (Prompt 15). '#'-prefixed lines are skipped.

export function GET(req: Request): Promise<Response> {
  return csvTemplateResponse(req, HOG_BULK_REVIEW_TEMPLATE, 'hog-bulk-review-template.csv');
}

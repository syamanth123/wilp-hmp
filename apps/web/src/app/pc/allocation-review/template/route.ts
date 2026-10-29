import { csvTemplateResponse } from '@/lib/csv-template-response';
import { PC_ALLOCATION_REVIEW_TEMPLATE } from '@/lib/bulk-templates';

// CSV template for PC bulk allocation review (Prompt 22). '#' lines are skipped.

export function GET(req: Request): Promise<Response> {
  return csvTemplateResponse(
    req,
    PC_ALLOCATION_REVIEW_TEMPLATE,
    'pc-allocation-review-template.csv',
  );
}

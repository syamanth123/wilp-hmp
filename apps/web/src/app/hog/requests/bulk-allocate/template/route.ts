import { csvTemplateResponse } from '@/lib/csv-template-response';
import { HOG_BULK_ALLOCATE_TEMPLATE } from '@/lib/bulk-templates';

// CSV template for the HOG bulk-allocation upload (Prompt 14). Header +
// #-commented sample rows (the parser skips '#'-prefixed lines). Multiple
// faculty go in one quoted, comma-separated cell.

export function GET(req: Request): Promise<Response> {
  return csvTemplateResponse(req, HOG_BULK_ALLOCATE_TEMPLATE, 'allocation-bulk-template.csv');
}

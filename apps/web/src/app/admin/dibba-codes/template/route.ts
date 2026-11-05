import { csvTemplateResponse } from '@/lib/csv-template-response';
import { DIBBA_PROGRAMME_CODES_TEMPLATE } from '@/lib/bulk-templates';

// CSV template for Admin → Dibba codes (v1.3.0). Admin only: the template helper checks the
// signed-in user may open /admin.
export function GET(req: Request): Promise<Response> {
  return csvTemplateResponse(req, DIBBA_PROGRAMME_CODES_TEMPLATE, 'dibba-programme-codes.csv');
}

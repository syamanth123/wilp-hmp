import { csvTemplateResponse } from '@/lib/csv-template-response';
import { PEOPLE_TEMPLATE } from '@/lib/people-import';

/**
 * The people upload template (v1.4): email, name, roles, department. Admin under /admin/people, the
 * Instruction Cell under /ic/people (the template helper checks the area).
 */
export function GET(req: Request): Promise<Response> {
  return csvTemplateResponse(req, PEOPLE_TEMPLATE, 'hmp-people-template.csv');
}

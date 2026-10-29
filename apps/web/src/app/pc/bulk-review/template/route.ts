import { csvTemplateResponse } from '@/lib/csv-template-response';

// CSV template for PC bulk review (Prompt 15). '#'-prefixed lines are skipped.
const TEMPLATE_CSV = `request_reference,action,comment
# action is one of: pc_approve | pc_rework. comment is required for pc_rework.
# HMP-2026-0042,pc_approve,
# HMP-2026-0043,pc_rework,Please tighten the evaluation rubric
`;

export function GET(req: Request): Promise<Response> {
  return csvTemplateResponse(req, TEMPLATE_CSV, 'pc-bulk-review-template.csv');
}

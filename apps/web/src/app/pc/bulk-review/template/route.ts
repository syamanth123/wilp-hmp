// CSV template for PC bulk review (Prompt 15). '#'-prefixed lines are skipped.
const TEMPLATE_CSV = `request_reference,action,comment
# action is one of: pc_approve | pc_rework. comment is required for pc_rework.
# HMP-2026-0042,pc_approve,
# HMP-2026-0043,pc_rework,Please tighten the evaluation rubric
`;

export function GET(): Response {
  return new Response(TEMPLATE_CSV, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="pc-bulk-review-template.csv"',
    },
  });
}

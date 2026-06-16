// CSV template for PC bulk allocation review (Prompt 22). '#' lines are skipped.
const TEMPLATE_CSV = `request_reference,action,comment
# action is one of: pc_confirm_allocation | pc_reject_allocation.
# comment is required for pc_reject_allocation (the reason HOG sees).
# HMP-2026-0042,pc_confirm_allocation,
# HMP-2026-0043,pc_reject_allocation,SME lacks expertise in distributed systems
`;

export function GET(): Response {
  return new Response(TEMPLATE_CSV, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="pc-allocation-review-template.csv"',
    },
  });
}

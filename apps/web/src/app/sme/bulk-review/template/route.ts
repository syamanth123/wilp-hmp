// CSV template for SME bulk review (Prompt 15). '#'-prefixed lines are skipped.
const TEMPLATE_CSV = `request_reference,action,comment
# action is one of: sme_approve | sme_revert. comment is required for sme_revert.
# HMP-2026-0042,sme_approve,
# HMP-2026-0043,sme_revert,Please add the experiential-learning component
`;

export function GET(): Response {
  return new Response(TEMPLATE_CSV, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="sme-bulk-review-template.csv"',
    },
  });
}

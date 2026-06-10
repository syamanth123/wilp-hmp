// CSV template for HOG bulk review (Prompt 15). '#'-prefixed lines are skipped.
const TEMPLATE_CSV = `request_reference,action,comment
# action is one of: hog_final_approve | hog_reject | hog_rework.
# comment is required for hog_reject and hog_rework.
# HMP-2026-0042,hog_final_approve,
# HMP-2026-0043,hog_reject,Does not meet the programme's depth bar
`;

export function GET(): Response {
  return new Response(TEMPLATE_CSV, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="hog-bulk-review-template.csv"',
    },
  });
}

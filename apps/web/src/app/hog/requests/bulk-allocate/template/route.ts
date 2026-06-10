// CSV template for the HOG bulk-allocation upload (Prompt 14). Header +
// #-commented sample rows (the parser skips '#'-prefixed lines). Multiple
// faculty go in one quoted, comma-separated cell.
const TEMPLATE_CSV = `request_reference,faculty_emails,sme_email
# Lines starting with '#' are ignored. Delete these examples or leave them — they are skipped.
# HMP-2026-0042,faculty@hmp.local,sme@hmp.local
# HMP-2026-0043,"a@hmp.local,b@hmp.local",sme@hmp.local
`;

export function GET(): Response {
  return new Response(TEMPLATE_CSV, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="allocation-bulk-template.csv"',
    },
  });
}

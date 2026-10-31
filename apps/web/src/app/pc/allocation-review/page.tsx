import { RoleName } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { BulkToolPage } from '@/components/bulk-tool';
import { BulkReviewForm } from '@/components/bulk-review-form';
import { pcBulkAllocationReviewAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function PcAllocationReviewPage() {
  requireRole(await getSessionUser(), RoleName.PROGRAMME_COMMITTEE);

  return (
    <BulkToolPage
      title="Bulk confirm allocations (upload)"
      sentence="Confirm, or send back to the Head of Group, many faculty allocations at once."
      templateHref="/pc/allocation-review/template"
      dashboardHref="/pc"
      help={
        <>
          <p>One row per request, with three columns:</p>
          <ul className="list-disc pl-5">
            <li>
              <code>request_reference</code> — the request number, e.g. <code>HMP-2026-0042</code>.
              Only allocations waiting for your confirmation can be included.
            </li>
            <li>
              <code>action</code> — exactly one of: <code>pc_confirm_allocation</code> (confirm; the
              faculty member can start) or <code>pc_reject_allocation</code> (send back to the Head
              of Group to allocate again).
            </li>
            <li>
              <code>comment</code> — required for <code>pc_reject_allocation</code>; up to 2,000
              characters. The Head of Group sees it as the reason.
            </li>
          </ul>
          <p>You can still confirm or send back one request at a time from its own page.</p>
        </>
      }
    >
      <BulkReviewForm action={pcBulkAllocationReviewAction} />
    </BulkToolPage>
  );
}

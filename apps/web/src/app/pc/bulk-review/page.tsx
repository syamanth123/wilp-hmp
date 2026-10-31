import { RoleName } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { BulkToolPage } from '@/components/bulk-tool';
import { BulkReviewForm } from '@/components/bulk-review-form';
import { pcBulkReviewAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function PcBulkReviewPage() {
  requireRole(await getSessionUser(), RoleName.PROGRAMME_COMMITTEE);

  return (
    <BulkToolPage
      title="Bulk review handouts"
      sentence="Approve and forward, or ask for changes on, many submitted handouts at once."
      templateHref="/pc/bulk-review/template"
      dashboardHref="/pc"
      help={
        <>
          <p>One row per handout, with three columns:</p>
          <ul className="list-disc pl-5">
            <li>
              <code>request_reference</code> — the request number, e.g. <code>HMP-2026-0042</code>.
              Only handouts waiting for your review can be included.
            </li>
            <li>
              <code>action</code> — exactly one of: <code>pc_approve</code> (approve and forward to
              the Head of Group) or <code>pc_rework</code> (send back to the faculty member for
              changes).
            </li>
            <li>
              <code>comment</code> — required for <code>pc_rework</code>; up to 2,000 characters.
              The faculty member sees it.
            </li>
          </ul>
        </>
      }
    >
      <BulkReviewForm action={pcBulkReviewAction} />
    </BulkToolPage>
  );
}

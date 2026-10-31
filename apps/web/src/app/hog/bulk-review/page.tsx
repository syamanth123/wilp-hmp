import { RoleName } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { BulkToolPage } from '@/components/bulk-tool';
import { BulkReviewForm } from '@/components/bulk-review-form';
import { hogBulkReviewAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function HogBulkReviewPage() {
  requireRole(await getSessionUser(), RoleName.HOG);

  return (
    <BulkToolPage
      title="Bulk review handouts"
      sentence="Give final approval, ask for changes or reject many handouts at once."
      templateHref="/hog/bulk-review/template"
      dashboardHref="/hog"
      help={
        <>
          <p>One row per handout, with three columns:</p>
          <ul className="list-disc pl-5">
            <li>
              <code>request_reference</code> — the request number, e.g. <code>HMP-2026-0042</code>.
              Only handouts waiting for your final approval can be included.
            </li>
            <li>
              <code>action</code> — exactly one of: <code>hog_final_approve</code> (approve),{' '}
              <code>hog_rework</code> (send back to the faculty member for changes) or{' '}
              <code>hog_reject</code> (reject).
            </li>
            <li>
              <code>comment</code> — required for <code>hog_rework</code> and{' '}
              <code>hog_reject</code>; up to 2,000 characters. The faculty member sees it.
            </li>
          </ul>
        </>
      }
    >
      <BulkReviewForm action={hogBulkReviewAction} />
    </BulkToolPage>
  );
}

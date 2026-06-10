import { RoleName } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, buttonVariants } from '@hmp/ui';
import { BulkReviewForm } from '@/components/bulk-review-form';
import { hogBulkReviewAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function HogBulkReviewPage() {
  requireRole(await getSessionUser(), RoleName.HOG);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Bulk review (Head of Group — final)</CardTitle>
          <CardDescription>
            Upload a CSV with columns <code>request_reference</code>, <code>action</code>,{' '}
            <code>comment</code>. Actions: <code>hog_final_approve</code>, <code>hog_reject</code>{' '}
            (comment required), or <code>hog_rework</code> (send back to faculty — comment
            required). Only requests in UNDER_REVIEW status are in your queue.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <a
            href="/hog/bulk-review/template"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
            download
          >
            Download CSV template
          </a>
          <BulkReviewForm action={hogBulkReviewAction} />
        </CardContent>
      </Card>
    </div>
  );
}

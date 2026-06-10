import { RoleName } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, buttonVariants } from '@hmp/ui';
import { BulkReviewForm } from '@/components/bulk-review-form';
import { smeBulkReviewAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function SmeBulkReviewPage() {
  requireRole(await getSessionUser(), RoleName.SME);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Bulk review (SME)</CardTitle>
          <CardDescription>
            Upload a CSV with columns <code>request_reference</code>, <code>action</code>,{' '}
            <code>comment</code>. Actions: <code>sme_approve</code> (forward to the Programme
            Committee) or <code>sme_revert</code> (send back to faculty — comment required). Only
            requests in SME_REVIEW assigned to you are in your queue.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <a
            href="/sme/bulk-review/template"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
            download
          >
            Download CSV template
          </a>
          <BulkReviewForm action={smeBulkReviewAction} />
        </CardContent>
      </Card>
    </div>
  );
}

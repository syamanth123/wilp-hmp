import { RoleName } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, buttonVariants } from '@hmp/ui';
import { BulkReviewForm } from '@/components/bulk-review-form';
import { pcBulkReviewAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function PcBulkReviewPage() {
  requireRole(await getSessionUser(), RoleName.PROGRAMME_COMMITTEE);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Bulk review (Programme Committee)</CardTitle>
          <CardDescription>
            Upload a CSV with columns <code>request_reference</code>, <code>action</code>,{' '}
            <code>comment</code>. Actions: <code>pc_approve</code> (forward to HOG) or{' '}
            <code>pc_rework</code> (send back to faculty — comment required). Only requests in
            SUBMITTED status are in your queue. The whole file is validated before anything is
            applied.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <a
            href="/pc/bulk-review/template"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
            download
          >
            Download CSV template
          </a>
          <BulkReviewForm action={pcBulkReviewAction} />
        </CardContent>
      </Card>
    </div>
  );
}

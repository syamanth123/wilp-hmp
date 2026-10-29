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
          <CardTitle>Bulk review handouts</CardTitle>
          <CardDescription>
            Approve, or send back for changes, many handouts at once from one spreadsheet. Columns:{' '}
            <code>request_reference</code>, <code>action</code> (<code>sme_approve</code> to forward
            to the Programme Committee, or <code>sme_revert</code> to send back to the faculty
            member) and <code>comment</code> (required for <code>sme_revert</code>). Only handouts
            waiting for your review can be included.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <a
            href="/sme/bulk-review/template"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
            download
          >
            Download template
          </a>
          <BulkReviewForm action={smeBulkReviewAction} />
        </CardContent>
      </Card>
    </div>
  );
}

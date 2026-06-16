import { RoleName } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, buttonVariants } from '@hmp/ui';
import { BulkReviewForm } from '@/components/bulk-review-form';
import { pcBulkAllocationReviewAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function PcAllocationReviewPage() {
  requireRole(await getSessionUser(), RoleName.PROGRAMME_COMMITTEE);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Bulk allocation review (Programme Committee)</CardTitle>
          <CardDescription>
            Review HOG&apos;s faculty/SME allocations in bulk. Upload a CSV with columns{' '}
            <code>request_reference</code>, <code>action</code>, <code>comment</code>. Actions:{' '}
            <code>pc_confirm_allocation</code> (faculty can begin work) or{' '}
            <code>pc_reject_allocation</code> (send back to HOG to re-allocate — comment required).
            Only requests in ALLOCATED status are in your allocation queue. The whole file is
            validated before anything is applied. Per-request review remains available on each
            request&apos;s page.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <a
            href="/pc/allocation-review/template"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
            download
          >
            Download CSV template
          </a>
          <BulkReviewForm action={pcBulkAllocationReviewAction} />
        </CardContent>
      </Card>
    </div>
  );
}

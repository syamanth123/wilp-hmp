import { RoleName } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, buttonVariants } from '@hmp/ui';
import { BulkAllocateForm } from './allocate-form';

export const dynamic = 'force-dynamic';

/**
 * HOG bulk faculty + SME allocation (Prompt 14). CSV references existing
 * REQUESTED requests by refNo and assigns faculty + a (mandatory) SME. The
 * single-allocation flow at /hog/requests/[id] is unchanged.
 */
export default async function BulkAllocatePage() {
  requireRole(await getSessionUser(), RoleName.HOG);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Bulk allocate faculty + SME</CardTitle>
          <CardDescription>
            Upload a CSV with columns <code>request_reference</code>, <code>faculty_emails</code>,
            and <code>sme_email</code>. Each row allocates faculty + an SME to an existing request
            (which must be in REQUESTED status) and moves it to ALLOCATED. Put multiple faculty in
            one quoted, comma-separated cell. The whole file is validated — including the per-
            semester off-campus cap — before anything is written; any invalid row rejects the
            upload.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <a
            href="/hog/requests/bulk-allocate/template"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
            download
          >
            Download CSV template
          </a>
          <BulkAllocateForm />
        </CardContent>
      </Card>
    </div>
  );
}

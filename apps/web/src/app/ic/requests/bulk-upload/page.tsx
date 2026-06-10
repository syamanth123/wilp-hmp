import { RoleName } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, buttonVariants } from '@hmp/ui';
import { BulkUploadForm } from './upload-form';

export const dynamic = 'force-dynamic';

/**
 * IC bulk handout-request upload (Prompt 13). Minimal CSV — programme + course
 * + semester only; HOG allocates faculty + SME separately (Prompt 14). The
 * single-request flow at /ic/requests/new is unchanged.
 */
export default async function BulkUploadPage() {
  requireRole(await getSessionUser(), RoleName.INSTRUCTION_CELL);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Bulk create handout requests</CardTitle>
          <CardDescription>
            Upload a CSV with columns <code>programme_code</code>, <code>course_code</code>, and{' '}
            <code>semester</code>. Each row creates one request in REQUESTED status; the Head of
            Group allocates faculty and SME afterwards. The whole file is validated before anything
            is created — if any row is invalid the upload is rejected and nothing is written.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <a
            href="/ic/requests/bulk-upload/template"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
            download
          >
            Download CSV template
          </a>
          <BulkUploadForm />
        </CardContent>
      </Card>
    </div>
  );
}

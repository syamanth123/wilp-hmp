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
            Create many handout requests at once from one spreadsheet. Each row (columns{' '}
            <code>programme_code</code>, <code>course_code</code>, <code>semester</code>) creates
            one request and sends it to the Head of Group. The whole file is checked first: if any
            row has a problem, nothing is created and every problem is listed.
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

import { RoleName } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { BulkToolPage } from '@/components/bulk-tool';
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
    <BulkToolPage
      title="Bulk allocate faculty (upload)"
      sentence="Allocate faculty and a subject expert to many new requests at once from one spreadsheet."
      templateHref="/hog/requests/bulk-allocate/template"
      dashboardHref="/hog"
      help={
        <>
          <p>One row per request, with three columns:</p>
          <ul className="list-disc pl-5">
            <li>
              <code>request_reference</code> — the request number, e.g. <code>HMP-2026-0042</code>.
              The request must be waiting for allocation.
            </li>
            <li>
              <code>faculty_emails</code> — the faculty member&apos;s email. For several faculty,
              put all their emails in one cell, in quotes, separated by commas.
            </li>
            <li>
              <code>sme_email</code> — the email of the subject expert who will review the handout.
            </li>
          </ul>
          <p>
            Each allocation goes to the Programme Committee to confirm. The limit on courses per
            off-campus faculty member this semester is checked for the whole file.
          </p>
        </>
      }
    >
      <BulkAllocateForm />
    </BulkToolPage>
  );
}

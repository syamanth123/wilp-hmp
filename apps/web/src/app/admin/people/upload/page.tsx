import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@hmp/ui';
import { UploadPeople } from './upload-people';

export const dynamic = 'force-dynamic';

/** Admin → People → Upload (v1.4): four columns, preview first, Apply saves all or nothing. */
export default function UploadPeoplePage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload people</CardTitle>
        <CardDescription>
          A CSV or Excel file with four columns — <code>email</code>, <code>name</code>,{' '}
          <code>roles</code> (e.g. <code>HOG;FACULTY</code>) and <code>department</code> (code or
          name). New emails become accounts; existing ones are updated; nobody is deleted. You see
          every row’s result before anything is saved.{' '}
          <a href="/admin/people/template" className="underline" download>
            Template
          </a>{' '}
          ·{' '}
          <a href="/admin/people/export" className="underline" download>
            Current list in this format
          </a>{' '}
          ·{' '}
          <Link href="/admin/people" className="underline">
            Back to People
          </Link>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <UploadPeople />
      </CardContent>
    </Card>
  );
}

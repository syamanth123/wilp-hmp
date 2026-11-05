import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@hmp/ui';
import { formatDateTime } from '@/lib/format-date';
import { loadRun } from '@/lib/taxila-runs';
import { taxilaSettings } from '@/lib/taxila-publish';
import { RunConsole } from './run-console';

export const dynamic = 'force-dynamic';

/** A bulk "publish to Taxila" run (v1.3.0) — resumable; see lib/taxila-runs.ts. */
export default async function TaxilaRunPage({ params }: { params: { id: string } }) {
  const run = await loadRun(params.id);
  if (!run) notFound();
  const cfg = taxilaSettings();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Bulk publish to Taxila — {run.semesterCode}</CardTitle>
        <CardDescription>
          {run.rows.length} approved handout{run.rows.length === 1 ? '' : 's'} · started by{' '}
          {run.createdBy} on {formatDateTime(run.createdAt)}
          {run.finishedAt && <> · finished {formatDateTime(run.finishedAt)}</>}. Each PDF goes into
          the “{cfg?.folderName ?? 'Course Handout'}” folder of its course. You can pause or close
          this page at any time and come back — nothing is published twice.{' '}
          <Link href="/ic/taxila-runs" className="underline">
            All runs
          </Link>
        </CardDescription>
      </CardHeader>
      <CardContent>
        {cfg ? (
          <RunConsole runId={run.id} initialRows={run.rows} initialStatus={run.status} />
        ) : (
          <p className="text-sm">Publishing to Taxila isn’t set up on this server.</p>
        )}
      </CardContent>
    </Card>
  );
}

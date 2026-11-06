import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@hmp/ui';
import { previewHogBackfill } from '@/lib/hog-backfill';
import type { PeopleBase } from '@/lib/people-access';
import { ApplyHogBackfill } from './forms';

/**
 * v1.4.1 (H4 / H11): "Give existing requests their department's HOG" — the preview (who gets whom, and
 * what can't be assigned and why, with a Fix link), then one Apply. Hidden once nothing is left.
 */
export async function HogBackfillCard({ base }: { base: PeopleBase }) {
  const p = await previewHogBackfill();
  if (p.assign.length === 0 && p.skipped.length === 0) return null;
  return (
    <Card data-testid="hog-backfill">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base">Existing requests without a HOG</CardTitle>
          <CardDescription data-testid="hog-backfill-summary">
            {p.assign.length} can get their department&apos;s HOG now
            {p.skipped.length > 0 && <>; {p.skipped.length} can&apos;t yet (below, with why)</>}.
            Nothing is changed until you press the button; a HOG already set is never replaced.
            Until then these requests stay visible to their department&apos;s HOGs (or to all HOGs
            when the department isn&apos;t known).
          </CardDescription>
        </div>
        <ApplyHogBackfill count={p.assign.length} />
      </CardHeader>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="text-muted-foreground text-left text-xs uppercase tracking-wide">
            <tr className="border-b">
              <th className="px-4 py-2 font-medium">Request</th>
              <th className="px-4 py-2 font-medium">Course</th>
              <th className="px-4 py-2 font-medium">Gets</th>
            </tr>
          </thead>
          <tbody>
            {p.assign.map((a) => (
              <tr key={a.requestId} className="border-b" data-testid="hog-backfill-row">
                <td className="px-4 py-2 font-mono text-xs">{a.refNo}</td>
                <td className="px-4 py-2">{a.course}</td>
                <td className="px-4 py-2 text-emerald-800">
                  {a.hogName} ({a.department})
                </td>
              </tr>
            ))}
            {p.skipped.map((s) => (
              <tr key={s.requestId} className="border-b" data-testid="hog-backfill-skipped">
                <td className="px-4 py-2 font-mono text-xs">{s.refNo}</td>
                <td className="px-4 py-2">{s.course}</td>
                <td className="px-4 py-2 text-amber-800">
                  {s.reason === 'department-unknown' ? (
                    <>
                      Programme {s.programmeCode} has no department —{' '}
                      <a href="#programmes" className="underline">
                        set it below
                      </a>
                    </>
                  ) : (
                    <>
                      {s.department ?? 'The department'} has no HOG yet —{' '}
                      <Link
                        href={`${base}/people?department=${s.departmentId}`}
                        className="underline"
                      >
                        set one in People
                      </Link>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

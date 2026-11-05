import Link from 'next/link';
import { prisma } from '@hmp/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@hmp/ui';
import { formatDateTime } from '@/lib/format-date';

export const dynamic = 'force-dynamic';

/** Recent bulk "publish to Taxila" runs — open one to carry on where it stopped. */
export default async function TaxilaRunsPage() {
  const runs = await prisma.taxilaPublishRun.findMany({
    orderBy: { createdAt: 'desc' },
    take: 30,
    include: {
      createdBy: { select: { name: true } },
      items: { select: { status: true } },
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Bulk publish runs</CardTitle>
        <CardDescription>
          Start one from the Handout Library → Published → “Approved, not yet published”: tick the
          handouts, then “Bulk publish to Taxila”.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {runs.length === 0 ? (
          <p className="text-muted-foreground p-6 text-sm">No runs yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-muted-foreground text-left text-xs uppercase tracking-wide">
              <tr className="border-b">
                <th className="px-4 py-2 font-medium">Started</th>
                <th className="px-4 py-2 font-medium">Semester code</th>
                <th className="px-4 py-2 font-medium">Handouts</th>
                <th className="px-4 py-2 font-medium">Published</th>
                <th className="px-4 py-2 font-medium">State</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="px-4 py-2">
                    <Link href={`/ic/taxila-runs/${r.id}`} className="underline">
                      {formatDateTime(r.createdAt)}
                    </Link>
                    <div className="text-muted-foreground text-xs">{r.createdBy.name}</div>
                  </td>
                  <td className="px-4 py-2 font-mono">{r.semesterCode}</td>
                  <td className="px-4 py-2 tabular-nums">{r.items.length}</td>
                  <td className="px-4 py-2 tabular-nums">
                    {r.items.filter((i) => i.status === 'PUBLISHED').length}
                  </td>
                  <td className="px-4 py-2">
                    {r.status === 'DONE' ? 'Finished' : 'In progress / paused'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

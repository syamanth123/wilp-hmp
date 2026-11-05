import { prisma } from '@hmp/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@hmp/ui';
import { loadDibbaCodeRows } from '@/lib/dibba-programme-codes';
import { CodeCsvUpload, CodeLinkSelect, SuggestLink } from './forms';

export const dynamic = 'force-dynamic';

/**
 * Admin → Dibba codes (v1.3.0, docs/plans/taxila-publish.md §A): link each programme code the Course
 * Dibba uses ("18BT/18ET", "HT15") to an HMP programme, so "Create request" knows which semester to
 * add a course offering to.
 */
export default async function DibbaCodesPage() {
  const [rows, programmes] = await Promise.all([
    loadDibbaCodeRows(),
    prisma.programme.findMany({
      where: { active: true },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true },
    }),
  ]);
  const linked = rows.filter((r) => r.resolved.programme).length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Course Dibba programme codes</CardTitle>
          <CardDescription>
            The Course Dibba names programmes by batch code (18BT/18ET, HT15, MB22 …). Link each one
            to an HMP programme so that <strong>Create request</strong> in the Handout Library can
            add the course to that programme&apos;s semester. A code that is the same as an HMP
            programme code (or one part of it) works without a link.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm" data-testid="dibba-codes-summary">
            {linked} of {rows.length} codes lead to an HMP programme.
          </p>
          <details className="rounded-md border p-3">
            <summary className="cursor-pointer text-sm font-medium">
              Upload many links (CSV)
            </summary>
            <div className="mt-3 space-y-3 text-sm">
              <p>
                Two columns: <code>code</code> (as the Dibba shows it) and{' '}
                <code>programme_code</code> (Admin → Programmes).{' '}
                <a href="/admin/dibba-codes/template" className="underline" download>
                  Download the template
                </a>
                .
              </p>
              <CodeCsvUpload />
            </div>
          </details>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="text-muted-foreground p-6 text-sm">
              No Course Dibba has been published yet (Instruction Cell → Course Dibba).
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground text-left text-xs uppercase tracking-wide">
                  <tr className="border-b">
                    <th className="px-4 py-2 font-medium">Dibba code</th>
                    <th className="px-4 py-2 font-medium">Programme (as in the Dibba)</th>
                    <th className="px-4 py-2 text-right font-medium">Courses</th>
                    <th className="px-4 py-2 font-medium">HMP programme</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.code}
                      className="border-b last:border-0"
                      data-testid="dibba-code-row"
                    >
                      <td className="px-4 py-2 font-mono">{r.code}</td>
                      <td className="px-4 py-2">{r.title}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{r.courses}</td>
                      <td className="px-4 py-2">
                        <CodeLinkSelect
                          code={r.code}
                          linkedProgrammeId={r.linkedProgrammeId}
                          programmes={programmes}
                        />
                        {r.suggestion && <SuggestLink code={r.code} programme={r.suggestion} />}
                        {!r.linkedProgrammeId && r.resolved.programme && (
                          <p className="text-muted-foreground mt-1 text-xs">
                            Matches {r.resolved.programme.code} by its code.
                          </p>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

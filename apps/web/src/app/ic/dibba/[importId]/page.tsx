import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  prisma,
  RoleName,
  DibbaImportStatus,
  countAcknowledgeableWarnings,
  normalizeBitsCourseNumber,
} from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { findCatalogueCourses, matchCourseCodes } from '@hmp/db/src/dibba-import';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@hmp/ui';
import { Stat } from '../stat';
import { fmtDateTime, fmtInt } from '../format';
import { WarningsPanel } from './warnings-panel';
import { UnknownCodes, type UnknownCode } from './unknown-codes';
import { ProgrammeTables } from './programme-tables';
import { PublishPanel } from './publish-panel';

export const dynamic = 'force-dynamic';

/**
 * /ic/dibba/[importId] — preview + publish (Course Dibba Phase 3, plan §1).
 * Reads only: the import, its entries, the term's current published import,
 * and one catalogue query for the LIVE "not in catalogue" buckets (D10).
 * The publish itself is a server action in actions.ts.
 */

const STATUS_BADGE: Record<
  DibbaImportStatus,
  { variant: 'secondary' | 'success' | 'outline'; label: string }
> = {
  DRAFT: { variant: 'secondary', label: 'Draft' },
  PUBLISHED: { variant: 'success', label: 'Published' },
  SUPERSEDED: { variant: 'outline', label: 'Superseded' },
};

/** True when the strict catalogue rule can hold this code at all. */
function catalogueShaped(code: string): boolean {
  try {
    normalizeBitsCourseNumber(code);
    return true;
  } catch {
    return false;
  }
}

export default async function DibbaPreviewPage({ params }: { params: { importId: string } }) {
  requireRole(await getSessionUser(), RoleName.INSTRUCTION_CELL);

  const imp = await prisma.dibbaImport.findUnique({
    where: { id: params.importId },
    include: {
      term: { select: { id: true, name: true, year: true, term: true } },
      uploadedBy: { select: { name: true } },
    },
  });
  if (!imp) notFound();

  const [entries, currentPublished] = await Promise.all([
    prisma.dibbaEntry.findMany({
      where: { importId: imp.id },
      orderBy: [
        { programmeCode: 'asc' },
        { admitBatch: 'asc' },
        { slotNo: 'asc' },
        { courseCode: 'asc' },
        { id: 'asc' },
      ],
    }),
    imp.status === DibbaImportStatus.PUBLISHED
      ? null
      : prisma.dibbaImport.findFirst({
          where: { termId: imp.termId, status: DibbaImportStatus.PUBLISHED },
          select: { id: true, label: true, publishedAt: true },
        }),
  ]);

  // Live catalogue match (D10): same matcher as the upload used for courseId.
  const distinctCodes = [...new Set(entries.map((e) => e.courseCode))];
  const linked = matchCourseCodes(distinctCodes, await findCatalogueCourses(prisma, distinctCodes));
  const perCode = new Map<string, UnknownCode>();
  for (const e of entries) {
    if (linked.has(e.courseCode)) continue;
    const u = perCode.get(e.courseCode) ?? { code: e.courseCode, rows: 0, title: e.courseTitle };
    u.rows += 1;
    perCode.set(e.courseCode, u);
  }
  const unknown = [...perCode.values()].sort(
    (a, b) => b.rows - a.rows || a.code.localeCompare(b.code),
  );
  const unmatchable = unknown.filter((u) => !catalogueShaped(u.code));
  const notFoundCodes = unknown.filter((u) => catalogueShaped(u.code));

  const programmes = new Set(entries.map((e) => e.programmeCode)).size;
  const withCount = entries.filter((e) => e.studentCount !== null).length;
  const withHint = entries.filter((e) => e.classTimeHint).length;
  const acknowledgeCount = countAcknowledgeableWarnings(imp.warnings);
  const badge = STATUS_BADGE[imp.status];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>
              {imp.term.name} — {imp.label}
            </CardTitle>
            <Badge variant={badge.variant} data-testid="dibba-preview-status">
              {badge.label}
            </Badge>
          </div>
          <CardDescription>
            <span className="font-mono">{imp.sourceFilename}</span> ({imp.sourceFormat}) · uploaded{' '}
            {fmtDateTime.format(imp.createdAt)} by {imp.uploadedBy.name}
            {imp.publishedAt ? ` · published ${fmtDateTime.format(imp.publishedAt)}` : ''} ·{' '}
            <Link href="/ic/dibba" className="underline-offset-4 hover:underline">
              back to terms &amp; imports
            </Link>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <Stat label="Rows" value={entries.length} testId="dibba-stat-rows" />
            <Stat
              label="Unique course codes"
              value={distinctCodes.length}
              testId="dibba-stat-codes"
            />
            <Stat label="Programmes" value={programmes} testId="dibba-stat-programmes" />
            <Stat label="Rows with a student count" value={withCount} />
            <Stat label="Rows with a class-time hint" value={withHint} />
            <Stat
              label="Codes not in catalogue"
              value={unknown.length}
              testId="dibba-stat-unknown"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Parser warnings ({fmtInt.format(imp.warnings.length)})
          </CardTitle>
          <CardDescription>
            Shown in full. The parser never silently &ldquo;fixes&rdquo; a header or a merged cell —
            it records what it did so you can check the printed Dibba.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <WarningsPanel warnings={imp.warnings} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Not in HMP catalogue</CardTitle>
        </CardHeader>
        <CardContent>
          <UnknownCodes unmatchable={unmatchable} notFound={notFoundCodes} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {imp.status === DibbaImportStatus.DRAFT ? 'Publish' : 'Status'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {imp.status === DibbaImportStatus.DRAFT ? (
            <PublishPanel
              importId={imp.id}
              label={imp.label}
              termName={imp.term.name}
              rowCount={fmtInt.format(entries.length)}
              acknowledgeCount={acknowledgeCount}
              currentPublished={
                currentPublished
                  ? {
                      label: currentPublished.label,
                      publishedAt: currentPublished.publishedAt
                        ? fmtDateTime.format(currentPublished.publishedAt)
                        : null,
                    }
                  : null
              }
            />
          ) : imp.status === DibbaImportStatus.PUBLISHED ? (
            <p className="text-sm" data-testid="dibba-status-line">
              This is the published schedule for {imp.term.name}
              {imp.publishedAt ? ` (since ${fmtDateTime.format(imp.publishedAt)})` : ''}. Upload a
              new file to replace it; publishing the new draft supersedes this one.
            </p>
          ) : (
            <p className="text-sm" data-testid="dibba-status-line">
              Superseded
              {imp.publishedAt ? ` — was published ${fmtDateTime.format(imp.publishedAt)}` : ''}.
              {currentPublished
                ? ` The current published import is '${currentPublished.label}'.`
                : ' No import is currently published for this term.'}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Programme tables ({programmes})</CardTitle>
          <CardDescription>
            One table per programme as in the Dibba; hover a code to see the source cell.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProgrammeTables entries={entries} linked={new Set(linked.keys())} />
        </CardContent>
      </Card>
    </div>
  );
}

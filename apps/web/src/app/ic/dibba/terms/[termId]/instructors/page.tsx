import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma, RoleName, DibbaImportStatus, InstructorSource } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@hmp/ui';
import { fmtInt } from '../../../format';
import { FacultySheetUploadForm } from './upload-form';
import { AddInstructorForm } from './add-form';
import { RemoveInstructorButton } from './remove-button';

export const dynamic = 'force-dynamic';

const UNCOVERED_SHOW = 50;

/**
 * /ic/dibba/terms/[termId]/instructors — who teaches what (Course Dibba Phase
 * 4, plan §1). Sheet upload, manual add/remove, the list grouped by course,
 * and the published Dibba's courses that have no instructor yet (plan D10).
 */
export default async function ICTermInstructorsPage({ params }: { params: { termId: string } }) {
  requireRole(await getSessionUser(), RoleName.INSTRUCTION_CELL);

  const term = await prisma.academicTerm.findUnique({
    where: { id: params.termId },
    select: {
      id: true,
      name: true,
      imports: {
        where: { status: DibbaImportStatus.PUBLISHED },
        select: { id: true, label: true },
        take: 1,
      },
    },
  });
  if (!term) notFound();

  const [instructors, publishedCodes] = await Promise.all([
    prisma.courseInstructor.findMany({
      where: { termId: term.id },
      select: {
        id: true,
        courseCode: true,
        isLead: true,
        source: true,
        user: { select: { name: true, email: true } },
      },
      orderBy: [{ courseCode: 'asc' }, { isLead: 'desc' }, { createdAt: 'asc' }],
    }),
    term.imports[0]
      ? prisma.dibbaEntry.findMany({
          where: { importId: term.imports[0].id },
          distinct: ['courseCode'],
          select: { courseCode: true, courseTitle: true },
          orderBy: { courseCode: 'asc' },
        })
      : Promise.resolve([]),
  ]);

  const titleByCode = new Map(publishedCodes.map((c) => [c.courseCode, c.courseTitle] as const));
  const groups = new Map<string, typeof instructors>();
  for (const row of instructors) {
    const g = groups.get(row.courseCode);
    if (g) g.push(row);
    else groups.set(row.courseCode, [row]);
  }
  const uncovered = publishedCodes.filter((c) => !groups.has(c.courseCode));
  const published = term.imports[0] ?? null;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-muted-foreground text-sm">
          <Link href="/ic/dibba" className="underline-offset-4 hover:underline">
            Course Dibba
          </Link>{' '}
          /{' '}
          <Link href={`/ic/dibba/terms/${term.id}`} className="underline-offset-4 hover:underline">
            {term.name}
          </Link>{' '}
          / Instructors
        </p>
        <h1 className="text-2xl font-semibold">Instructors — {term.name}</h1>
        <p className="text-muted-foreground text-sm" data-testid="dibba-instructors-summary">
          {fmtInt.format(instructors.length)} instructor rows across {fmtInt.format(groups.size)}{' '}
          courses
          {published
            ? ` · ${fmtInt.format(uncovered.length)} of the ${fmtInt.format(publishedCodes.length)} courses in the published Dibba have no instructor yet`
            : ' · no published Dibba for this term yet'}
          . HMP handout assignments count as well; they are read live on the faculty schedule.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Import the faculty sheet</CardTitle>
          <CardDescription>
            The Instruction Cell&rsquo;s faculty → course list. Rows are matched to HMP accounts by
            email; &ldquo;(LEAD)&rdquo; after a name marks the lead instructor.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FacultySheetUploadForm termId={term.id} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Add an instructor by hand</CardTitle>
          <CardDescription>
            For a course the sheet missed. The email must belong to an existing account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AddInstructorForm termId={term.id} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Who teaches what</CardTitle>
          <CardDescription>
            Grouped by course code. Sheet rows are replaced by the next import; manual rows stay.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {groups.size === 0 ? (
            <p className="text-muted-foreground text-sm" data-testid="dibba-instructor-list-empty">
              No instructors recorded for this term yet.
            </p>
          ) : (
            <div className="space-y-4" data-testid="dibba-instructor-list">
              {[...groups.entries()].map(([code, rows]) => (
                <div key={code} data-testid={`dibba-instructor-group-${code.replace(/\s+/g, '-')}`}>
                  <p className="text-sm font-medium">
                    <span className="font-mono">{code}</span>
                    {titleByCode.get(code) ? (
                      <span className="text-muted-foreground"> — {titleByCode.get(code)}</span>
                    ) : published ? (
                      <span className="text-muted-foreground text-xs">
                        {' '}
                        — not in the published Dibba
                      </span>
                    ) : null}
                  </p>
                  <ul className="mt-1 space-y-1">
                    {rows.map((r) => (
                      <li
                        key={r.id}
                        className="flex flex-wrap items-center gap-2 text-sm"
                        data-testid={`dibba-instructor-row-${r.id}`}
                      >
                        <span>{r.user.name}</span>
                        <span className="text-muted-foreground font-mono text-xs">
                          {r.user.email}
                        </span>
                        {r.isLead && <Badge variant="success">Lead</Badge>}
                        <Badge
                          variant={r.source === InstructorSource.MANUAL ? 'secondary' : 'outline'}
                        >
                          {r.source === InstructorSource.MANUAL
                            ? 'Manual'
                            : r.source === InstructorSource.DIBBA_SHEET
                              ? 'Sheet'
                              : 'Assignment'}
                        </Badge>
                        <RemoveInstructorButton
                          id={r.id}
                          termId={term.id}
                          who={`${r.user.name} (${code})`}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {published && (
        <Card>
          <CardHeader>
            <CardTitle>Uncovered in the published Dibba</CardTitle>
            <CardDescription>
              Courses in &ldquo;{published.label}&rdquo; with no instructor from the sheet or added
              by hand. Handout assignments are not counted here.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {uncovered.length === 0 ? (
              <p
                className="text-muted-foreground text-sm"
                data-testid="dibba-uncovered-courses"
                data-count="0"
              >
                Every course has at least one instructor.
              </p>
            ) : (
              <ul
                className="columns-1 text-sm md:columns-2 lg:columns-3"
                data-testid="dibba-uncovered-courses"
                data-count={uncovered.length}
              >
                {uncovered.slice(0, UNCOVERED_SHOW).map((c) => (
                  <li key={c.courseCode}>
                    <span className="font-mono">{c.courseCode}</span>{' '}
                    <span className="text-muted-foreground">{c.courseTitle}</span>
                  </li>
                ))}
                {uncovered.length > UNCOVERED_SHOW && (
                  <li className="text-muted-foreground">
                    …and {fmtInt.format(uncovered.length - UNCOVERED_SHOW)} more
                  </li>
                )}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

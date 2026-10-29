import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma, RoleName, DibbaImportStatus } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@hmp/ui';
import { Stat } from '../../stat';
import { fmtDate, fmtInt } from '../../format';
import { toDateInputValue } from '../../date-input';
import { EditTermForm } from './edit-term-form';
import { termLabel } from '@/lib/labels';

export const dynamic = 'force-dynamic';

/**
 * /ic/dibba/terms/[termId] — term details + edit (Course Dibba Phase 4, plan
 * §1). Links to the slots (class times, exam dates) and instructors pages.
 */
export default async function ICTermPage({ params }: { params: { termId: string } }) {
  requireRole(await getSessionUser(), RoleName.INSTRUCTION_CELL);

  const term = await prisma.academicTerm.findUnique({
    where: { id: params.termId },
    include: {
      _count: { select: { imports: true, instructors: true, examDates: true } },
      slots: { select: { slotNo: true, startTime: true }, orderBy: { slotNo: 'asc' } },
      imports: {
        where: { status: DibbaImportStatus.PUBLISHED },
        select: { id: true, label: true, publishedAt: true, rowCount: true },
        take: 1,
      },
    },
  });
  if (!term) notFound();

  const published = term.imports[0] ?? null;
  const slotsWithTimes = term.slots.filter((s) => s.startTime).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-muted-foreground text-sm">
            <Link href="/ic/dibba" className="underline-offset-4 hover:underline">
              Course Dibba
            </Link>{' '}
            / Term
          </p>
          <h1 className="text-2xl font-semibold" data-testid="dibba-term-title">
            {term.name}
          </h1>
          <p className="text-muted-foreground text-sm">
            {termLabel(term.term)} {term.year} · {fmtDate.format(term.startDate)} –{' '}
            {fmtDate.format(term.endDate)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/ic/dibba/terms/${term.id}/slots`}
            className="rounded-md border px-3 py-1.5 text-sm"
            data-testid="dibba-term-slots-link"
          >
            Slots: class times &amp; exam dates
          </Link>
          <Link
            href={`/ic/dibba/terms/${term.id}/instructors`}
            className="rounded-md border px-3 py-1.5 text-sm"
            data-testid="dibba-term-instructors-link"
          >
            Instructors
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Imports" value={term._count.imports} testId="dibba-term-stat-imports" />
        <Stat
          label="Slots with a class time (of 8)"
          value={slotsWithTimes}
          testId="dibba-term-stat-slots"
        />
        <Stat
          label="Exam dates entered"
          value={term._count.examDates}
          testId="dibba-term-stat-exams"
        />
        <Stat
          label="Instructor rows"
          value={term._count.instructors}
          testId="dibba-term-stat-instructors"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Published schedule</CardTitle>
          <CardDescription>The Dibba import faculty currently see for this term.</CardDescription>
        </CardHeader>
        <CardContent>
          {published ? (
            <p className="text-sm" data-testid="dibba-term-published">
              <Badge variant="success">Published</Badge>{' '}
              <Link href={`/ic/dibba/${published.id}`} className="underline underline-offset-4">
                {published.label}
              </Link>{' '}
              · {fmtInt.format(published.rowCount)} rows
              {published.publishedAt ? ` · since ${fmtDate.format(published.publishedAt)}` : ''}
            </p>
          ) : (
            <p className="text-muted-foreground text-sm" data-testid="dibba-term-published">
              Nothing published yet — upload and publish a Dibba from the Course Dibba page.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Edit term</CardTitle>
          <CardDescription>
            Name, year/term and dates. The end date drives the &ldquo;days remaining&rdquo; cards.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EditTermForm
            term={{
              id: term.id,
              name: term.name,
              year: term.year,
              term: term.term,
              startDate: toDateInputValue(term.startDate),
              endDate: toDateInputValue(term.endDate),
              hasPublishedImport: published !== null,
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}

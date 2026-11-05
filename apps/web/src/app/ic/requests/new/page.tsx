import Link from 'next/link';
import { prisma, RoleName, normalizeDibbaCourseCode } from '@hmp/db';
import { getSessionUser } from '@hmp/auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@hmp/ui';
import { RequestForm, type OfferingOption } from './request-form';

/** "?courses=ET ZC232,ENGG ZC232&term=2025-FIRST" — the Handout Library's "Create request". */
function parsePrefill(sp: Record<string, string | undefined>) {
  const codes = (sp.courses ?? '')
    .split(',')
    .slice(0, 12)
    .flatMap((c) => {
      try {
        return [normalizeDibbaCourseCode(c)];
      } catch {
        return [];
      }
    });
  const term = /^(\d{4})-(FIRST|SECOND|SUMMER)$/.exec(sp.term ?? '');
  return codes.length && term ? { codes, year: Number(term[1]), term: term[2]! } : null;
}

export default async function NewRequestPage({
  searchParams = {},
}: {
  searchParams?: Record<string, string | undefined>;
}) {
  // Filter out offerings whose Course was deactivated (e.g. the pre-Prompt-11b
  // invented codes the seed marks `active: false`). Matches the active-filter
  // convention already used in faculty-load / recommender / embeddings /
  // notifications. Admin views intentionally do NOT filter.
  const offerings = await prisma.courseOffering.findMany({
    where: { course: { active: true } },
    include: { course: true, semester: { include: { programme: true } } },
    orderBy: [{ semester: { name: 'asc' } }, { course: { code: 'asc' } }],
  });

  const options: OfferingOption[] = offerings.map((o) => ({
    id: o.id,
    courseCode: o.course.code,
    courseTitle: o.course.title,
    programmeCode: o.semester.programme.code,
    programmeName: o.semester.programme.name,
    semesterName: o.semester.name,
    slotInfo: o.slotInfo,
  }));

  // Filled in from a not-started course: its offering in that semester, when one is loaded.
  const prefill = parsePrefill(searchParams);
  const matches = prefill
    ? offerings.filter(
        (o) =>
          o.semester.year === prefill.year &&
          o.semester.term === prefill.term &&
          [o.course.code, o.course.bitsCourseNumber, ...o.course.alternateCodes].some((c) =>
            prefill.codes.includes(c),
          ),
      )
    : [];
  const initial = matches[0]
    ? {
        programmeCode: matches[0].semester.programme.code,
        semesterName: matches[0].semester.name,
        offeringId: matches[0].id,
      }
    : undefined;
  const semesterName = prefill
    ? ((
        await prisma.semester.findFirst({
          where: { year: prefill.year, term: prefill.term },
          select: { name: true },
        })
      )?.name ?? null)
    : null;
  const isAdmin = prefill
    ? ((await getSessionUser())?.roles.includes(RoleName.ADMIN) ?? false)
    : false;

  return (
    <Card>
      <CardHeader>
        <CardTitle>New handout request</CardTitle>
        <CardDescription>
          Pick the course offering. The request goes straight to the Head of Group to allocate
          faculty.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {prefill && (
          <p
            className={
              initial
                ? 'bg-accent rounded-md border px-3 py-2 text-sm'
                : 'rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900'
            }
            data-testid="prefill-note"
            data-found={initial ? 'yes' : 'no'}
          >
            {initial ? (
              <>
                Filled in from the Handout Library: {prefill.codes.join(' / ')},{' '}
                {semesterName ?? 'this semester'}.
                {matches.length > 1 &&
                  ` It is offered in ${matches.length} programmes — check the programme before you create the request.`}
              </>
            ) : (
              <>
                {prefill.codes.join(' / ')} has no course offering for{' '}
                {semesterName ?? 'that semester'} yet, so it can’t be picked here.{' '}
                {isAdmin ? (
                  <>
                    Load it first under{' '}
                    <Link href="/admin/import" className="underline">
                      Import academic data
                    </Link>
                    .
                  </>
                ) : (
                  'Ask the administrator to load it, then come back.'
                )}
              </>
            )}
          </p>
        )}
        {options.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No course offerings yet. Ask the administrator to load this term&apos;s course
            offerings.
          </p>
        ) : (
          <RequestForm offerings={options} initial={initial} />
        )}
      </CardContent>
    </Card>
  );
}

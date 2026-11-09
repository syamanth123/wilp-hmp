import Link from 'next/link';
import { prisma, RoleName, normalizeDibbaCourseCode } from '@hmp/db';
import { getSessionUser } from '@hmp/auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@hmp/ui';
import { RequestForm, type HogOption, type OfferingOption } from './request-form';
import { SetUpOffering } from './set-up-offering';
import { loadPlanInput, planMessage, planOffering } from '@/lib/dibba-offering';
import { loads, loadText } from '@/lib/people';

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
    include: {
      course: true,
      semester: { include: { programme: { include: { department: true } } } },
    },
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
    departmentId: o.semester.programme.departmentId,
    departmentName: o.semester.programme.department?.name ?? null,
  }));

  // v1.4: every active HOG with their department and current load (the form pre-selects the course's).
  const hogUsers = await prisma.user.findMany({
    where: { active: true, roles: { some: { role: { name: RoleName.HOG } } } },
    select: { id: true, name: true, departmentId: true, department: { select: { name: true } } },
    orderBy: { name: 'asc' },
  });
  const hogLoads = await loads(hogUsers.map((h) => h.id));
  const hogs: HogOption[] = hogUsers.map((h) => ({
    id: h.id,
    name: h.name,
    departmentId: h.departmentId,
    departmentName: h.department?.name ?? null,
    load: loadText(hogLoads.get(h.id)),
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
  // An explicit offering (just added from the Dibba) wins; otherwise the first match.
  const match = matches.find((o) => o.id === searchParams.offering) ?? matches[0];
  const initial = match
    ? {
        programmeCode: match.semester.programme.code,
        semesterName: match.semester.name,
        offeringId: match.id,
      }
    : undefined;
  // No offering yet: what adding one from the Course Dibba would do (shown for confirmation).
  const plan =
    prefill && !initial
      ? planOffering(await loadPlanInput(prefill.codes, prefill.year, prefill.term))
      : null;
  const isAdmin = plan
    ? ((await getSessionUser())?.roles.includes(RoleName.ADMIN) ?? false)
    : false;
  const codes = plan?.codes ?? prefill?.codes ?? [];
  const showForm = !plan;

  return (
    <Card>
      <CardHeader>
        <CardTitle>New handout request</CardTitle>
        <CardDescription>
          Pick the course offering. The request goes to the Head of Group of the course&apos;s
          department, who allocates the faculty.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {prefill && initial && match && (
          <p
            className="bg-accent rounded-md border px-3 py-2 text-sm"
            data-testid="prefill-note"
            data-found="yes"
          >
            {searchParams.added === '1' ? 'Added' : 'Filled in from the Handout Library:'}{' '}
            {codes.join(' / ')}
            {searchParams.added === '1' ? ' to ' : ', '}
            {match.semester.name} ({match.semester.programme.code}).
            {codes.length > 1 &&
              ` This request covers all ${codes.length} codes: ${codes.join(', ')}.`}
            {matches.length > 1 &&
              !searchParams.offering &&
              ` It is offered in ${matches.length} programmes — check the programme before you create the request.`}
          </p>
        )}
        {plan?.kind === 'ready' && (
          <SetUpOffering
            codes={plan.codes}
            term={`${prefill!.year}-${prefill!.term}`}
            title={plan.title}
            newCourse={!plan.course}
            skippedCodes={plan.skippedCodes}
            choices={plan.choices.map((c) => ({
              semesterId: c.semesterId,
              programmeCode: c.programmeCode,
              dibbaProgramme: c.dibbaProgramme,
              semesterName: c.semesterName,
            }))}
            notSetUp={plan.notSetUp}
            mixedNumbers={plan.mixedNumbers}
          />
        )}
        {plan && plan.kind !== 'ready' && (
          <div
            className="space-y-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
            data-testid="prefill-note"
            data-found="no"
            data-reason={plan.kind}
          >
            <p>{planMessage(plan)}</p>
            <p className="space-x-3">
              {isAdmin && plan.kind === 'not-set-up' && plan.unlinked.length > 0 && (
                <Link href="/admin/dibba-codes" className="underline">
                  Admin → Dibba programme codes
                </Link>
              )}
              {isAdmin && plan.kind === 'not-set-up' && plan.noSemester.length > 0 && (
                <Link href="/admin/import" className="underline">
                  Admin → Import (programmes and semesters)
                </Link>
              )}
              {isAdmin && plan.kind === 'invalid-code' && (
                <Link href="/admin/programmes" className="underline">
                  Admin → Programmes
                </Link>
              )}
              <Link href="/handouts?tab=in-progress&view=not-started" className="underline">
                Back to Not started yet
              </Link>
              <Link href="/ic/requests/new" className="underline">
                Start a blank request
              </Link>
            </p>
          </div>
        )}
        {showForm &&
          (options.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No course offerings yet. Ask the administrator to load this term&apos;s course
              offerings.
            </p>
          ) : (
            <RequestForm offerings={options} hogs={hogs} initial={initial} />
          ))}
      </CardContent>
    </Card>
  );
}

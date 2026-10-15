import { prisma, DibbaImportStatus } from '@hmp/db';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@hmp/ui';
import { loadActiveTerm } from '@hmp/db/src/dibba-schedule/load';
import { loadTermOverview, type OverviewCourse } from '@hmp/db/src/dibba-schedule/overview';

const fmtInt = new Intl.NumberFormat('en-IN');
const fmtDate = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});
const COURSE_ROWS_SHOWN = 300;

/** Next 14 hands a repeated query key over as an array; only the first value is honoured. */
type Param = string | string[] | undefined;

export interface ScheduleOverviewSearchParams {
  term?: Param;
  programme?: Param;
  slot?: Param;
  faculty?: Param;
}

const first = (v: Param): string => (Array.isArray(v) ? (v[0] ?? '') : (v ?? ''));

function Tile({
  label,
  value,
  testId,
  tone,
}: {
  label: string;
  value: number;
  testId: string;
  tone?: 'bad';
}) {
  return (
    <div
      className={`rounded-md border p-3 ${tone === 'bad' && value > 0 ? 'border-red-300 bg-red-50' : ''}`}
      data-testid={testId}
      data-count={value}
    >
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="text-2xl font-semibold">{fmtInt.format(value)}</div>
    </div>
  );
}

/**
 * Term overview for HOG / PC (Course Dibba Phase 6, spec §7–8). Server component;
 * the term and the filters travel in the query string (plain GET form, no client
 * JS). The check lists are term-wide; the filters narrow the courses table only.
 */
export async function ScheduleOverview({
  basePath,
  searchParams,
}: {
  basePath: string;
  searchParams: ScheduleOverviewSearchParams;
}) {
  const terms = await prisma.academicTerm.findMany({
    where: { imports: { some: { status: DibbaImportStatus.PUBLISHED } } },
    select: { id: true, name: true },
    orderBy: [{ year: 'desc' }, { term: 'asc' }],
  });
  const active = await loadActiveTerm(prisma);
  const requestedTerm = first(searchParams.term);
  const termId =
    requestedTerm && terms.some((t) => t.id === requestedTerm)
      ? requestedTerm
      : (active?.id ?? terms[0]?.id ?? null);
  const overview = termId ? await loadTermOverview(prisma, { termId }) : null;

  if (!overview || !overview.published) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Schedule overview</h1>
        <p
          className="text-muted-foreground rounded-md border p-6 text-sm"
          data-testid="schedule-overview-empty"
        >
          No term has a published Course Dibba yet. The Instruction Cell publishes one from the
          Course Dibba page.
        </p>
      </div>
    );
  }

  const programme = first(searchParams.programme);
  const slotRaw = first(searchParams.slot);
  const slot = /^[0-8]$/.test(slotRaw) ? Number(slotRaw) : null;
  const faculty = first(searchParams.faculty);
  const filtered = overview.courses.filter(
    (c) =>
      (!programme || c.programmes.includes(programme)) &&
      (slot === null || c.slotNos.includes(slot)) &&
      (!faculty || c.instructors.some((i) => i.userId === faculty)),
  );
  const facultyName = faculty ? overview.faculty.find((f) => f.userId === faculty)?.name : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Schedule overview</h1>
          <p className="text-muted-foreground text-sm" data-testid="schedule-overview-term">
            {overview.term.name} · {fmtDate.format(overview.term.startDate)} –{' '}
            {fmtDate.format(overview.term.endDate)} · schedule &ldquo;{overview.published.label}
            &rdquo;
            {overview.published.publishedAt
              ? ` published ${fmtDate.format(overview.published.publishedAt)}`
              : ''}
          </p>
        </div>
        <form method="get" action={basePath} className="flex flex-wrap items-end gap-2 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs">Term</span>
            <select
              name="term"
              defaultValue={overview.term.id}
              className="bg-background h-9 rounded-md border px-2"
            >
              {terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs">Programme</span>
            <select
              name="programme"
              defaultValue={programme}
              className="bg-background h-9 rounded-md border px-2"
            >
              <option value="">All</option>
              {overview.programmes.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs">Slot</span>
            <select
              name="slot"
              defaultValue={slot === null ? '' : String(slot)}
              className="bg-background h-9 rounded-md border px-2"
            >
              <option value="">All</option>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                <option key={n} value={n}>
                  SL{n}
                </option>
              ))}
              <option value="0">No slot</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs">Faculty</span>
            <select
              name="faculty"
              defaultValue={faculty}
              className="bg-background h-9 max-w-56 rounded-md border px-2"
            >
              <option value="">All</option>
              {overview.faculty.map((f) => (
                <option key={f.userId} value={f.userId}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="bg-primary text-primary-foreground h-9 rounded-md px-3 text-sm"
          >
            Apply
          </button>
        </form>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
        <Tile label="Courses" value={overview.courses.length} testId="schedule-tile-courses" />
        <Tile
          label="Faculty teaching"
          value={overview.faculty.length}
          testId="schedule-tile-faculty"
        />
        <Tile
          label="Clashes"
          value={overview.clashes.length}
          testId="schedule-tile-clashes"
          tone="bad"
        />
        <Tile
          label="Uncovered courses"
          value={overview.uncovered.length}
          testId="schedule-tile-uncovered"
          tone="bad"
        />
        <Tile
          label="Off-campus over limit"
          value={overview.offCampusLoad.length}
          testId="schedule-tile-offcampus"
          tone="bad"
        />
        <Tile
          label="Slot drift"
          value={overview.slotDrift.length}
          testId="schedule-tile-drift"
          tone="bad"
        />
        <Tile
          label="Not in catalogue"
          value={overview.notInCatalogue.length}
          testId="schedule-tile-catalogue"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Clashes</CardTitle>
          <CardDescription>
            Same faculty member, same slot, two different courses (cross-listed codes count as one).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {overview.clashes.length === 0 ? (
            <p
              className="text-muted-foreground text-sm"
              data-testid="schedule-clashes"
              data-count="0"
            >
              No clashes.
            </p>
          ) : (
            <ul
              className="space-y-1 text-sm"
              data-testid="schedule-clashes"
              data-count={overview.clashes.length}
            >
              {overview.clashes.map((c) => (
                <li key={`${c.userId}|${c.slotNo}`}>
                  <span className="font-medium">{c.name}</span> · SL{c.slotNo} {c.day} {c.session}:{' '}
                  <span className="font-mono">{c.codes.join(', ')}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Uncovered courses</CardTitle>
            <CardDescription>
              In the Dibba with a slot, but no instructor from assignments, the sheet or manual
              entries.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CourseList
              courses={overview.uncovered}
              testId="schedule-uncovered"
              empty="Every slotted course has an instructor."
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Off-campus load</CardTitle>
            <CardDescription>
              Off-campus faculty teaching more than {overview.offCampusMaxCourses} distinct courses.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {overview.offCampusLoad.length === 0 ? (
              <p
                className="text-muted-foreground text-sm"
                data-testid="schedule-offcampus"
                data-count="0"
              >
                Nobody over the limit.
              </p>
            ) : (
              <ul
                className="space-y-1 text-sm"
                data-testid="schedule-offcampus"
                data-count={overview.offCampusLoad.length}
              >
                {overview.offCampusLoad.map((f) => (
                  <li key={f.userId}>
                    <span className="font-medium">{f.name}</span> · {f.courseCount} courses (limit{' '}
                    {f.limit}): <span className="font-mono">{f.codes.join(', ')}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Slot drift</CardTitle>
            <CardDescription>
              A course offering in HMP states a slot the Dibba does not use for that course.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {overview.slotDrift.length === 0 ? (
              <p
                className="text-muted-foreground text-sm"
                data-testid="schedule-drift"
                data-count="0"
              >
                No drift between HMP offerings and the Dibba.
              </p>
            ) : (
              <ul
                className="space-y-1 text-sm"
                data-testid="schedule-drift"
                data-count={overview.slotDrift.length}
              >
                {overview.slotDrift.map((d, idx) => (
                  <li key={`${d.code}|${d.semesterName}|${d.programmeCode}|${idx}`}>
                    <span className="font-mono">{d.code}</span> · HMP says &ldquo;{d.slotInfo}
                    &rdquo; ({d.programmeCode} {d.semesterName}), Dibba has SL
                    {d.dibbaSlots.join(', SL')}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Not in the HMP catalogue</CardTitle>
            <CardDescription>
              Dibba codes with no matching Course (number or alternate code).
            </CardDescription>
          </CardHeader>
          <CardContent>
            {overview.notInCatalogue.length === 0 ? (
              <p
                className="text-muted-foreground text-sm"
                data-testid="schedule-not-in-catalogue"
                data-count="0"
              >
                Every Dibba code is in the catalogue.
              </p>
            ) : (
              <ul
                className="columns-1 text-sm md:columns-2"
                data-testid="schedule-not-in-catalogue"
                data-count={overview.notInCatalogue.length}
              >
                {overview.notInCatalogue.slice(0, COURSE_ROWS_SHOWN).map((c) => (
                  <li key={c.code}>
                    <span className="font-mono">{c.code}</span>{' '}
                    <span className="text-muted-foreground">{c.title}</span>
                  </li>
                ))}
                {overview.notInCatalogue.length > COURSE_ROWS_SHOWN && (
                  <li className="text-muted-foreground">
                    …and {fmtInt.format(overview.notInCatalogue.length - COURSE_ROWS_SHOWN)} more
                  </li>
                )}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            Courses{' '}
            <span className="text-muted-foreground text-sm font-normal">
              (<span data-testid="schedule-courses-count">{fmtInt.format(filtered.length)}</span> of{' '}
              {fmtInt.format(overview.courses.length)}
              {programme ? ` · programme ${programme}` : ''}
              {slot !== null && !Number.isNaN(slot)
                ? ` · ${slot === 0 ? 'no slot' : `SL${slot}`}`
                : ''}
              {facultyName ? ` · ${facultyName}` : ''})
            </span>
          </CardTitle>
          <CardDescription>
            Every course in the published Dibba with its slots, programmes, students and
            instructors.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="schedule-courses">
              <thead>
                <tr className="text-muted-foreground border-b text-left text-xs">
                  <th className="py-2 pr-3 font-medium">Code</th>
                  <th className="py-2 pr-3 font-medium">Title</th>
                  <th className="py-2 pr-3 font-medium">Slots</th>
                  <th className="py-2 pr-3 font-medium">Programmes</th>
                  <th className="py-2 pr-3 text-right font-medium">Students</th>
                  <th className="py-2 pr-3 font-medium">Instructors</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, COURSE_ROWS_SHOWN).map((c) => (
                  <tr key={c.code} className="border-b align-top last:border-0">
                    <td className="whitespace-nowrap py-1.5 pr-3 font-mono">
                      {c.code}
                      {!c.inCatalogue && (
                        <>
                          {' '}
                          <Badge variant="outline">not in catalogue</Badge>
                        </>
                      )}
                    </td>
                    <td className="py-1.5 pr-3">{c.title}</td>
                    <td className="whitespace-nowrap py-1.5 pr-3">
                      {c.slotNos.map((s) => (s === 0 ? 'no slot' : `SL${s}`)).join(', ')}
                    </td>
                    <td className="py-1.5 pr-3 text-xs">{c.programmes.join(', ')}</td>
                    <td className="py-1.5 pr-3 text-right">{fmtInt.format(c.students)}</td>
                    <td className="py-1.5 pr-3 text-xs">
                      {c.instructors.length === 0 ? (
                        <span className="text-red-700">none</span>
                      ) : (
                        c.instructors.map((i, idx) => (
                          <span key={i.userId}>
                            {idx > 0 ? ', ' : ''}
                            {i.name}
                            {i.isLead ? ' (Lead)' : ''}
                          </span>
                        ))
                      )}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-muted-foreground py-4 text-center">
                      No course matches these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {filtered.length > COURSE_ROWS_SHOWN && (
              <p className="text-muted-foreground mt-2 text-xs">
                Showing the first {COURSE_ROWS_SHOWN} of {fmtInt.format(filtered.length)} — narrow
                with the filters.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function CourseList({
  courses,
  testId,
  empty,
}: {
  courses: OverviewCourse[];
  testId: string;
  empty: string;
}) {
  if (courses.length === 0) {
    return (
      <p className="text-muted-foreground text-sm" data-testid={testId} data-count="0">
        {empty}
      </p>
    );
  }
  return (
    <ul className="columns-1 text-sm md:columns-2" data-testid={testId} data-count={courses.length}>
      {courses.slice(0, COURSE_ROWS_SHOWN).map((c) => (
        <li key={c.code}>
          <span className="font-mono">{c.code}</span>{' '}
          <span className="text-muted-foreground">{c.title}</span>{' '}
          <span className="text-muted-foreground text-xs">
            (SL{c.slotNos.filter((s) => s >= 1).join(', SL')}, {fmtInt.format(c.students)} students)
          </span>
        </li>
      ))}
      {courses.length > COURSE_ROWS_SHOWN && (
        <li className="text-muted-foreground">
          …and {fmtInt.format(courses.length - COURSE_ROWS_SHOWN)} more
        </li>
      )}
    </ul>
  );
}

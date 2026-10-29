import { prisma, RoleName } from '@hmp/db';
import { getSessionUser, requireRole } from '@hmp/auth';
import { nextEvents } from '@hmp/db/src/dibba-schedule';
import { loadFacultySchedule } from '@hmp/db/src/dibba-schedule/load';
import { NextEventsCard } from '@/components/next-events-card';
import { WeekGrid } from './week-grid';
import { CourseCard } from './course-card';
import { dateFormatter } from '@/lib/format-date';

export const dynamic = 'force-dynamic';

// One date style everywhere, in India time (lib/format-date.ts).
const fmtDate = dateFormatter;

/**
 * /faculty/schedule — "My Schedule" (Course Dibba Phase 5, spec §8). Read-only.
 * Everything comes from loadFacultySchedule(me.id): the session user is the only
 * key — no user id is ever read from the URL (spec §9).
 */
export default async function FacultySchedulePage() {
  const me = requireRole(await getSessionUser(), RoleName.FACULTY);
  const now = new Date();
  const schedule = await loadFacultySchedule(prisma, { userId: me.id, now });
  const next = nextEvents(schedule, now);
  const term = schedule.term;
  const empty = schedule.courses.length === 0 && schedule.noSlot.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">My Schedule</h1>
          <p className="text-muted-foreground text-sm" data-testid="faculty-schedule-term">
            {term && schedule.published
              ? `${term.name} · ${fmtDate.format(term.startDate)} – ${fmtDate.format(term.endDate)} · schedule "${schedule.published.label}"${
                  schedule.published.publishedAt
                    ? ` published ${fmtDate.format(schedule.published.publishedAt)}`
                    : ''
                }`
              : 'No published schedule yet.'}
          </p>
        </div>
      </div>

      {!term || !schedule.published ? (
        <p
          className="text-muted-foreground rounded-md border p-6 text-sm"
          data-testid="faculty-schedule-empty"
        >
          The Instruction Cell has not published a Course Dibba for any term yet. Your schedule
          appears here as soon as one is published.
        </p>
      ) : empty ? (
        <p
          className="text-muted-foreground rounded-md border p-6 text-sm"
          data-testid="faculty-schedule-empty"
        >
          None of your courses appear in the published schedule for {term.name}. Courses reach this
          page through your handout assignments and the Instruction Cell&rsquo;s instructor list —
          if a course of yours is missing, ask the Instruction Cell to add you.
        </p>
      ) : (
        <>
          <NextEventsCard next={next} termName={term.name} />

          <section className="space-y-2">
            <h2 className="text-lg font-medium">Week</h2>
            <WeekGrid grid={schedule.grid} />
          </section>

          {schedule.clashes.length > 0 && (
            <div
              className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800"
              role="alert"
              data-testid="faculty-schedule-clashes"
            >
              <p className="font-medium">
                {schedule.clashes.length === 1
                  ? 'One slot clash'
                  : `${schedule.clashes.length} slot clashes`}{' '}
                in your schedule — tell the Instruction Cell:
              </p>
              <ul className="mt-1 list-disc pl-5">
                {schedule.clashes.map((c) => (
                  <li key={c.slotNo}>
                    SL{c.slotNo} {c.day} {c.session}:{' '}
                    <span className="font-mono">{c.codes.join(', ')}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <section className="space-y-3">
            <h2 className="text-lg font-medium">
              Courses{' '}
              <span className="text-muted-foreground text-sm font-normal">
                ({schedule.courses.length})
              </span>
            </h2>
            {schedule.courses.map((c) => (
              <CourseCard key={c.key} course={c} />
            ))}
          </section>

          {schedule.noSlot.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-lg font-medium">Without a slot (projects, dissertations)</h2>
              {schedule.noSlot.map((c) => (
                <CourseCard key={c.key} course={c} />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
